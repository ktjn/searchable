import copy
import datetime
import math
import sys
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any

from searchable_analysis import Token, analyze, get_language_profile, normalize_phrase

from searchable_indexer.document import FieldDefinition, IndexDocument, compute_content_hash
from searchable_indexer.extract import extract_document
from searchable_indexer.facets import (
    RANGE_FACET_BUCKET_COUNT,
    add_facet_values,
    add_range_facet_values,
    compute_range_facet_buckets_equal_width,
    compute_range_facet_buckets_explicit,
)
from searchable_indexer.fuzzy import build_fuzzy_shard
from searchable_indexer.pins import resolve_pins
from searchable_indexer.synonyms import build_synonym_shards
from searchable_indexer.types import BuiltIndex, PinDeclaration, SourceDocument
from searchable_indexer.vectors import build_vector_shards

_DEFAULT_FIELD_BOOSTS = {"title": 3.0, "body": 1.0}
_EXCERPT_LENGTH = 200


def _validate_source_ids(sources: list[SourceDocument]) -> None:
    seen: set[int] = set()
    for source in sources:
        if not isinstance(source.id, int) or isinstance(source.id, bool) or source.id < 0:
            raise ValueError(
                f"invalid document id {source.id!r} for "
                f'"{source.url}" -- ids must be non-negative integers'
            )
        if source.id in seen:
            raise ValueError(
                f"duplicate document id {source.id} "
                f'(seen again at "{source.url}") -- every source document '
                "must have a unique id"
            )
        seen.add(source.id)


def _derive_excerpt(body: str) -> str:
    if len(body) <= _EXCERPT_LENGTH:
        return body
    return body[:_EXCERPT_LENGTH].rstrip() + "…"


def _validate_boost(value: object, subject: str, *, allow_zero: bool = False) -> None:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or value < 0
        or (value == 0 and not allow_zero)
    ):
        requirement = "non-negative" if allow_zero else "positive"
        raise ValueError(
            f"invalid boost {value!r} for {subject} -- "
            f"must be a finite, {requirement} number"
        )


def _validate_field_definitions(field_definitions: dict[str, FieldDefinition]) -> None:
    if not isinstance(field_definitions, dict):
        raise ValueError(
            "field_definitions must be a dict[str, FieldDefinition]"
        )
    for name, definition in field_definitions.items():
        if not isinstance(name, str) or not name:
            raise ValueError(
                f"invalid field name {name!r} in field_definitions "
                "-- field names must be non-empty strings"
            )
        if not isinstance(definition, FieldDefinition):
            raise ValueError(
                f'field_definitions["{name}"] must be a '
                f"FieldDefinition, got {type(definition).__name__}"
            )
        if not definition.indexed and not definition.stored:
            raise ValueError(
                f'field "{name}" is declared neither indexed nor '
                "stored -- every field must be indexed, stored, or both"
            )
        _validate_boost(definition.boost, f'field "{name}"', allow_zero=True)


def _validate_json_value(value: object, path: str) -> None:
    if value is None or isinstance(value, (bool, str, int)):
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError(
                f"{path} is not finite ({value!r}) -- "
                "metadata must be JSON-compatible"
            )
        return
    if isinstance(value, list):
        for i, item in enumerate(value):
            _validate_json_value(item, f"{path}[{i}]")
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise ValueError(
                    f"{path} has a non-string metadata key {key!r}"
                )
            _validate_json_value(item, f"{path}.{key}")
        return
    raise ValueError(
        f"{path} is not JSON-compatible "
        f"({type(value).__name__}) -- metadata must be JSON-compatible"
    )


def _validate_index_document(
    document: IndexDocument,
    field_definitions: dict[str, FieldDefinition],
    seen_ids: set[int],
    seen_external_ids: set[str],
) -> None:
    if not isinstance(document.id, int) or isinstance(document.id, bool) or document.id < 0:
        raise ValueError(
            f"invalid document id {document.id!r} -- "
            "ids must be non-negative integers"
        )
    if document.id in seen_ids:
        raise ValueError(
            f"duplicate document id {document.id} -- "
            "every document must have a unique id"
        )
    seen_ids.add(document.id)

    if document.external_id is not None:
        if not isinstance(document.external_id, str) or document.external_id == "":
            raise ValueError(
                f"document {document.id} has invalid external_id "
                f"{document.external_id!r} -- must be a non-empty string when supplied"
            )
        if document.external_id in seen_external_ids:
            raise ValueError(
                f"duplicate external_id "
                f"{document.external_id!r} (document {document.id}) -- external ids must "
                "be unique when supplied"
            )
        seen_external_ids.add(document.external_id)

    if not isinstance(document.url, str):
        raise ValueError(
            f"document {document.id} has non-string url {document.url!r}"
        )
    if not isinstance(document.language, str) or document.language == "":
        raise ValueError(
            f"document {document.id} has invalid language "
            f"{document.language!r} -- must be a non-empty string"
        )
    if not isinstance(document.indexed_fields, dict):
        raise ValueError(
            f"document {document.id} indexed_fields must be a dict"
        )
    if not isinstance(document.stored_fields, dict):
        raise ValueError(
            f"document {document.id} stored_fields must be a dict"
        )

    for name, value in document.indexed_fields.items():
        definition = field_definitions.get(name)
        if definition is None or not definition.indexed:
            raise ValueError(
                f'document {document.id} has indexed field "{name}" '
                "not declared with indexed=True in field_definitions"
            )
        if not isinstance(value, str):
            raise ValueError(
                f'document {document.id} field "{name}" '
                f"(indexed_fields) must be a string, got {type(value).__name__}"
            )

    for name, value in document.stored_fields.items():
        definition = field_definitions.get(name)
        if definition is None or not definition.stored:
            raise ValueError(
                f'document {document.id} has stored field "{name}" '
                "not declared with stored=True in field_definitions"
            )
        if not isinstance(value, str):
            raise ValueError(
                f'document {document.id} field "{name}" '
                f"(stored_fields) must be a string, got {type(value).__name__}"
            )

    if not document.indexed_fields:
        raise ValueError(
            f"document {document.id} has no indexed fields -- "
            "at least one indexed field is required"
        )

    _validate_boost(document.boost, f"document {document.id}")

    if not isinstance(document.metadata, dict):
        raise ValueError(f"document {document.id} metadata must be a dict")
    _validate_json_value(document.metadata, f"document {document.id} metadata")


def _validate_range_facet_buckets(range_facet_buckets: dict[str, int | list[float]]) -> None:
    for field_name, config in range_facet_buckets.items():
        if isinstance(config, list):
            if len(config) < 1 or not all(math.isfinite(n) for n in config):
                raise ValueError(
                    f"invalid range_facet_buckets boundaries {config!r} "
                    f'for field "{field_name}" -- must be a non-empty list of finite numbers'
                )
            for i in range(1, len(config)):
                if config[i] <= config[i - 1]:
                    raise ValueError(
                        f"invalid range_facet_buckets boundaries {config!r} "
                        f'for field "{field_name}" -- must be strictly ascending'
                    )
        else:
            if not isinstance(config, int) or isinstance(config, bool) or config < 1:
                raise ValueError(
                    f"invalid range_facet_buckets count {config!r} "
                    f'for field "{field_name}" -- must be a positive integer'
                )


def _add_postings(
    shard: dict[str, Any],
    posting_index: dict[str, dict[int, Any]],
    field_name: str,
    doc_id: int,
    doc_boost: float,
    tokens: list[Token],
) -> None:
    field_length = len(tokens)
    positions_by_term: dict[str, list[int]] = {}
    for token in tokens:
        positions_by_term.setdefault(token.term, []).append(token.position)

    for term, positions in positions_by_term.items():
        entry = shard.setdefault(term, {"df": 0, "postings": []})
        doc_index = posting_index.setdefault(term, {})
        posting = doc_index.get(doc_id)
        if posting is None:
            posting = {"doc": doc_id, "fields": {}}
            if doc_boost != 1.0:
                posting["boost"] = doc_boost
            entry["postings"].append(posting)
            entry["df"] += 1
            doc_index[doc_id] = posting
        posting["fields"][field_name] = {
            "tf": len(positions),
            "pos": positions,
            "len": field_length,
        }


@dataclass
class _PreparedDocument:
    document: IndexDocument
    facets: dict[str, list[str]] = field(default_factory=dict)
    range_facets: dict[str, float] = field(default_factory=dict)
    pins: list[PinDeclaration] = field(default_factory=list)
    vector_text: str | None = None


def _copy_document(document: IndexDocument) -> IndexDocument:
    if not isinstance(document.indexed_fields, dict):
        raise ValueError(
            f"document {document.id} indexed_fields must be a dict"
        )
    if not isinstance(document.stored_fields, dict):
        raise ValueError(
            f"document {document.id} stored_fields must be a dict"
        )
    return IndexDocument(
        id=document.id,
        external_id=document.external_id,
        url=document.url,
        language=document.language,
        indexed_fields=dict(document.indexed_fields),
        stored_fields=dict(document.stored_fields),
        metadata=copy.deepcopy(document.metadata),
        boost=document.boost,
    )


def _copy_field_definitions(
    field_definitions: dict[str, FieldDefinition],
) -> dict[str, FieldDefinition]:
    return {
        name: FieldDefinition(
            indexed=definition.indexed, stored=definition.stored, boost=definition.boost
        )
        for name, definition in field_definitions.items()
    }


def _build_prepared_documents(
    prepared: list[_PreparedDocument],
    *,
    field_definitions: dict[str, FieldDefinition],
    default_language: str,
    hierarchical_facets: dict[str, dict[str, Any]] | None = None,
    range_facet_buckets: dict[str, int | list[float]] | None = None,
    synonyms: dict[str, dict[str, Any]] | None = None,
    fuzzy: bool = False,
    fuzzy_max_edits: int = 1,
    content_hash: bool = False,
    structured: bool = False,
    embed: Callable[[list[str]], list[list[float]]] | None = None,
    embedding_provider: dict[str, Any] | None = None,
    vector_quantization: str = "int8",
    vector_window: int = 200,
    vector_overlap: int = 20,
    vector_chunking: bool = True,
) -> BuiltIndex:
    hierarchical_facets = hierarchical_facets or {}
    range_facet_buckets = range_facet_buckets or {}
    _validate_range_facet_buckets(range_facet_buckets)
    if fuzzy_max_edits not in (1, 2):
        raise ValueError(
            f"invalid fuzzy_max_edits {fuzzy_max_edits!r} -- must be 1 or 2"
        )
    if embed is not None and embedding_provider is None:
        raise ValueError(
            "embedding_provider is required when embed is set -- "
            "query-time provider compatibility (SearchClientOptions.embedQuery) "
            "can't be established without it"
        )
    if vector_quantization not in ("int8", "float32"):
        raise ValueError(
            f"invalid vector_quantization {vector_quantization!r} "
            '-- must be "int8" or "float32"'
        )
    if not isinstance(vector_window, int) or isinstance(vector_window, bool) or vector_window <= 0:
        raise ValueError(
            f"invalid vector_window {vector_window!r} -- must be a positive integer"
        )
    if (
        not isinstance(vector_overlap, int)
        or isinstance(vector_overlap, bool)
        or vector_overlap < 0
        or vector_overlap >= vector_window
    ):
        raise ValueError(
            f"invalid vector_overlap {vector_overlap!r} -- must be "
            f">= 0 and < vector_window ({vector_window!r})"
        )

    seen_ids: set[int] = set()
    seen_external_ids: set[str] = set()
    for item in prepared:
        _validate_index_document(item.document, field_definitions, seen_ids, seen_external_ids)

    indexed_field_names = sorted(
        name for name, definition in field_definitions.items() if definition.indexed
    )

    term_shards: dict[str, dict[str, Any]] = {}
    posting_index_by_language: dict[str, dict[str, dict[int, Any]]] = {}
    doc_store: dict[str, Any] = {}
    facet_shards: dict[str, dict[str, Any]] = {}
    pins_acc_by_language: dict[str, dict[str, dict[str, Any]]] = {}
    stats_by_language: dict[str, dict[str, int]] = {}
    vector_documents: list[tuple[int, str, str]] = []
    indexed_count = 0
    min_id: int | None = None
    max_id: int | None = None

    for item in prepared:
        document = item.document
        language = document.language
        profile = get_language_profile(language)

        stats = stats_by_language.setdefault(
            language, {**{name: 0 for name in indexed_field_names}, "count": 0}
        )
        stats["count"] += 1

        term_shard = term_shards.setdefault(language, {})
        posting_index = posting_index_by_language.setdefault(language, {})
        for field_name in indexed_field_names:
            text = document.indexed_fields.get(field_name)
            if text is None:
                continue
            tokens = analyze(text, profile)
            stats[field_name] += len(tokens)
            _add_postings(
                term_shard, posting_index, field_name, document.id, document.boost, tokens
            )

        add_facet_values(facet_shards, item.facets, document.id, hierarchical_facets)
        add_range_facet_values(facet_shards, item.range_facets, document.id)

        if item.pins:
            pins_acc = pins_acc_by_language.setdefault(language, {})
            for pin in item.pins:
                normalized = normalize_phrase(pin.phrase, profile)
                if not normalized:
                    continue
                acc = pins_acc.setdefault(normalized, {"mode": pin.mode, "docs": []})
                acc["docs"].append(
                    {
                        "id": document.id,
                        "priority": pin.priority,
                        "exclusive": pin.exclusive,
                        "boost": document.boost,
                    }
                )

        entry: dict[str, Any] = {"url": document.url, "fields": dict(document.stored_fields)}
        if document.boost != 1.0:
            entry["boost"] = document.boost
        if document.external_id is not None:
            entry["externalId"] = document.external_id
        if document.metadata:
            entry["metadata"] = document.metadata
        if content_hash:
            entry["contentHash"] = compute_content_hash(document)
        doc_store[str(document.id)] = entry

        if item.vector_text is not None:
            vector_documents.append((document.id, language, item.vector_text))

        indexed_count += 1
        min_id = document.id if min_id is None else min(min_id, document.id)
        max_id = document.id if max_id is None else max(max_id, document.id)

    pins_shards, pin_warnings = resolve_pins(pins_acc_by_language)
    for warning in pin_warnings:
        print(f"[searchable-indexer] {warning}", file=sys.stderr)

    for term_shard in term_shards.values():
        for entry in term_shard.values():
            entry["postings"].sort(key=lambda p: p["doc"])

    for field_name, shard in facet_shards.items():
        if shard.get("sorted") is not None:
            shard["sorted"].sort(key=lambda e: (e["value"], e["doc"]))
        if shard["type"] == "range":
            config = range_facet_buckets.get(field_name, RANGE_FACET_BUCKET_COUNT)
            if isinstance(config, list):
                compute_range_facet_buckets_explicit(shard, config)
            else:
                compute_range_facet_buckets_equal_width(shard, config)
    for shard in facet_shards.values():
        for entry in shard["values"].values():
            entry["docs"].sort()

    facet_fields = sorted(facet_shards.keys())
    languages = sorted(stats_by_language.keys()) if stats_by_language else [default_language]

    doc_count: dict[str, int] = {}
    avg_field_length: dict[str, dict[str, float]] = {}
    for language in languages:
        lang_stats = stats_by_language.get(language)
        count = lang_stats["count"] if lang_stats else 0
        doc_count[language] = count
        avg_field_length[language] = {
            name: ((lang_stats[name] / count) if lang_stats and count else 0.0)
            for name in indexed_field_names
        }

    fuzzy_shards: dict[str, dict[str, Any]] = {}
    if fuzzy:
        for language, term_shard in term_shards.items():
            fuzzy_shards[language] = build_fuzzy_shard(term_shard, fuzzy_max_edits)

    manifest_fields = {
        name: {
            "indexed": definition.indexed,
            "stored": definition.stored,
            **({"boost": definition.boost} if definition.indexed else {}),
        }
        for name, definition in sorted(field_definitions.items())
    }

    manifest = {
        "version": 1,
        "buildId": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "format": "json",
        "languages": languages,
        "defaultLanguage": default_language,
        "fields": manifest_fields,
        **({"facetFields": facet_fields} if facet_fields else {}),
        "docCount": doc_count,
        "avgFieldLength": avg_field_length,
        "shards": {"terms": [], "docs": []},
    }

    id_range: tuple[int, int]
    if indexed_count and min_id is not None and max_id is not None:
        id_range = (min_id, max_id)
    else:
        id_range = (0, 0)

    vector_shards: dict[str, dict[str, Any]] = {}
    if embed is not None and vector_documents:
        vector_shards = build_vector_shards(
            vector_documents,
            embed,
            quantization=vector_quantization,
            window=vector_window,
            overlap=vector_overlap,
            chunk=vector_chunking,
        )

    return BuiltIndex(
        manifest=manifest,
        term_shards=term_shards,
        doc_store=doc_store,
        id_range=id_range,
        facet_shards=facet_shards,
        pins_shards=pins_shards,
        synonym_shards=build_synonym_shards(synonyms),
        fuzzy_shards=fuzzy_shards,
        vector_shards=vector_shards,
        embedding_provider=embedding_provider if embed is not None else None,
        structured=structured,
    )


def build_index_documents(
    documents: Iterable[IndexDocument],
    *,
    field_definitions: dict[str, FieldDefinition],
    default_language: str = "en",
    synonyms: dict[str, dict[str, Any]] | None = None,
    fuzzy: bool = False,
    fuzzy_max_edits: int = 1,
    embed: Callable[[list[str]], list[list[float]]] | None = None,
    embedding_provider: dict[str, Any] | None = None,
    vector_quantization: str = "int8",
    vector_window: int = 200,
    vector_overlap: int = 20,
    vector_field: str | None = None,
) -> BuiltIndex:
    _validate_field_definitions(field_definitions)
    copied_definitions = _copy_field_definitions(field_definitions)
    if embed is not None:
        if vector_field is None:
            raise ValueError("vector_field is required when embed is set")
        if vector_field not in copied_definitions or not copied_definitions[vector_field].indexed:
            raise ValueError(
                f'vector_field "{vector_field}" must reference '
                "a declared indexed field"
            )
    prepared = []
    for document in documents:
        copied_document = _copy_document(document)
        vector_text = None
        if embed is not None:
            if vector_field not in copied_document.indexed_fields:
                raise ValueError(
                    f"document {copied_document.id} is missing "
                    f'vector_field "{vector_field}"'
                )
            vector_text = copied_document.indexed_fields[vector_field]
        prepared.append(_PreparedDocument(document=copied_document, vector_text=vector_text))
    return _build_prepared_documents(
        prepared,
        field_definitions=copied_definitions,
        default_language=default_language,
        synonyms=synonyms,
        fuzzy=fuzzy,
        fuzzy_max_edits=fuzzy_max_edits,
        content_hash=True,
        structured=True,
        embed=embed,
        embedding_provider=embedding_provider,
        vector_quantization=vector_quantization,
        vector_window=vector_window,
        vector_overlap=vector_overlap,
        vector_chunking=False,
    )


def _legacy_field_definitions(field_boosts: dict[str, float] | None) -> dict[str, FieldDefinition]:
    boosts = {**_DEFAULT_FIELD_BOOSTS, **(field_boosts or {})}
    return {
        "title": FieldDefinition(indexed=True, stored=True, boost=boosts["title"]),
        "body": FieldDefinition(indexed=True, stored=False, boost=boosts["body"]),
        "excerpt": FieldDefinition(indexed=False, stored=True, boost=1.0),
    }


def _prepare_html_document(
    source: SourceDocument,
    default_language: str,
    allowed_url_origins: list[str] | None,
    canonical_base_url: str | None,
) -> _PreparedDocument | None:
    extracted = extract_document(
        source.html,
        source.url,
        default_language,
        allowed_url_origins=allowed_url_origins,
        canonical_base_url=canonical_base_url,
    )
    if extracted.noindex:
        return None
    document = IndexDocument(
        id=source.id,
        external_id=None,
        url=extracted.url,
        language=extracted.language,
        indexed_fields={"title": extracted.title, "body": extracted.body},
        stored_fields={
            "title": extracted.title,
            "excerpt": extracted.excerpt or _derive_excerpt(extracted.body),
        },
        metadata={},
        boost=extracted.boost,
    )
    return _PreparedDocument(
        document=document,
        facets=extracted.facets,
        range_facets=extracted.range_facets,
        pins=extracted.pins,
        vector_text=extracted.body,
    )


def build_index(
    sources: list[SourceDocument],
    default_language: str = "en",
    field_boosts: dict[str, float] | None = None,
    allowed_url_origins: list[str] | None = None,
    canonical_base_url: str | None = None,
    hierarchical_facets: dict[str, dict[str, Any]] | None = None,
    range_facet_buckets: dict[str, int | list[float]] | None = None,
    synonyms: dict[str, dict[str, Any]] | None = None,
    fuzzy: bool = False,
    fuzzy_max_edits: int = 1,
    embed: Callable[[list[str]], list[list[float]]] | None = None,
    embedding_provider: dict[str, Any] | None = None,
    vector_quantization: str = "int8",
    vector_window: int = 200,
    vector_overlap: int = 20,
) -> BuiltIndex:
    _validate_source_ids(sources)

    prepared: list[_PreparedDocument] = []
    for source in sources:
        item = _prepare_html_document(
            source, default_language, allowed_url_origins, canonical_base_url
        )
        if item is not None:
            prepared.append(item)

    return _build_prepared_documents(
        prepared,
        field_definitions=_legacy_field_definitions(field_boosts),
        default_language=default_language,
        hierarchical_facets=hierarchical_facets,
        range_facet_buckets=range_facet_buckets,
        synonyms=synonyms,
        fuzzy=fuzzy,
        fuzzy_max_edits=fuzzy_max_edits,
        content_hash=False,
        structured=False,
        embed=embed,
        embedding_provider=embedding_provider,
        vector_quantization=vector_quantization,
        vector_window=vector_window,
        vector_overlap=vector_overlap,
    )
