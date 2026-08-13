import copy
import datetime
import math
import sys
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

from searchable_analysis import (
    analyze,
    get_language_profile,
    normalize_phrase,
)
from selectolax.parser import HTMLParser

from searchable_indexer.document import (
    FieldDefinition,
    IndexDocument,
    JsonValue,
    compute_content_hash,
)
from searchable_indexer.extract import _extract, extract_pre_section_body, extract_sections
from searchable_indexer.facets import (
    RANGE_FACET_BUCKET_COUNT,
    add_facet_values,
    add_range_facet_values,
    compute_range_facet_buckets_equal_width,
    compute_range_facet_buckets_explicit,
)
from searchable_indexer.fuzzy import build_fuzzy_shard
from searchable_indexer.pins import resolve_pins
from searchable_indexer.postings import add_postings
from searchable_indexer.synonyms import build_synonym_shards
from searchable_indexer.types import (
    BuiltIndex,
    ExtractedDocument,
    ExtractedSection,
    PinDeclaration,
    SectionIndexingConfig,
    SourceDocument,
)

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
            f"invalid boost {value!r} for {subject} -- must be a finite, {requirement} number"
        )


def _validate_field_definitions(field_definitions: dict[str, FieldDefinition]) -> None:
    if not isinstance(field_definitions, dict):
        raise ValueError("field_definitions must be a dict[str, FieldDefinition]")
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
                f"{path} is not finite ({value!r}) -- metadata must be JSON-compatible"
            )
        return
    if isinstance(value, list):
        for i, item in enumerate(value):
            _validate_json_value(item, f"{path}[{i}]")
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise ValueError(f"{path} has a non-string metadata key {key!r}")
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
            f"invalid document id {document.id!r} -- ids must be non-negative integers"
        )
    if document.id in seen_ids:
        raise ValueError(
            f"duplicate document id {document.id} -- every document must have a unique id"
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
        raise ValueError(f"document {document.id} has non-string url {document.url!r}")
    if not isinstance(document.language, str) or document.language == "":
        raise ValueError(
            f"document {document.id} has invalid language "
            f"{document.language!r} -- must be a non-empty string"
        )
    if not isinstance(document.indexed_fields, dict):
        raise ValueError(f"document {document.id} indexed_fields must be a dict")
    if not isinstance(document.stored_fields, dict):
        raise ValueError(f"document {document.id} stored_fields must be a dict")

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


@dataclass
class _PreparedDocument:
    document: IndexDocument
    facets: dict[str, list[str]] = field(default_factory=dict)
    range_facets: dict[str, float] = field(default_factory=dict)
    pins: list[PinDeclaration] = field(default_factory=list)


def _copy_document(document: IndexDocument) -> IndexDocument:
    if not isinstance(document.indexed_fields, dict):
        raise ValueError(f"document {document.id} indexed_fields must be a dict")
    if not isinstance(document.stored_fields, dict):
        raise ValueError(f"document {document.id} stored_fields must be a dict")
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


@dataclass(frozen=True)
class BuildConfig:
    """Bundles every knob of an index build so `_build_prepared_documents`
    takes a single configuration object instead of ~15 keyword parameters."""

    field_definitions: dict[str, FieldDefinition]
    default_language: str = "en"
    hierarchical_facets: dict[str, dict[str, Any]] | None = None
    range_facet_buckets: dict[str, int | list[float]] | None = None
    synonyms: dict[str, dict[str, Any]] | None = None
    fuzzy: bool = False
    fuzzy_max_edits: int = 1
    content_hash: bool = False
    structured: bool = False


def _build_prepared_documents(prepared: list[_PreparedDocument], config: BuildConfig) -> BuiltIndex:
    hierarchical_facets = config.hierarchical_facets or {}
    range_facet_buckets = config.range_facet_buckets or {}
    _validate_range_facet_buckets(range_facet_buckets)
    if config.fuzzy_max_edits not in (1, 2):
        raise ValueError(f"invalid fuzzy_max_edits {config.fuzzy_max_edits!r} -- must be 1 or 2")

    seen_ids: set[int] = set()
    seen_external_ids: set[str] = set()
    for item in prepared:
        _validate_index_document(
            item.document, config.field_definitions, seen_ids, seen_external_ids
        )

    indexed_field_names = sorted(
        name for name, definition in config.field_definitions.items() if definition.indexed
    )

    term_shards: dict[str, dict[str, Any]] = {}
    posting_index_by_language: dict[str, dict[str, dict[int, Any]]] = {}
    doc_store: dict[str, Any] = {}
    facet_shards: dict[str, dict[str, Any]] = {}
    pins_acc_by_language: dict[str, dict[str, dict[str, Any]]] = {}
    stats_by_language: dict[str, dict[str, int]] = {}
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
            add_postings(term_shard, posting_index, field_name, document.id, document.boost, tokens)

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
        if config.content_hash:
            entry["contentHash"] = compute_content_hash(document)
        doc_store[str(document.id)] = entry

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
            bucket_config = range_facet_buckets.get(field_name, RANGE_FACET_BUCKET_COUNT)
            if isinstance(bucket_config, list):
                compute_range_facet_buckets_explicit(shard, bucket_config)
            else:
                compute_range_facet_buckets_equal_width(shard, bucket_config)
    for shard in facet_shards.values():
        for entry in shard["values"].values():
            entry["docs"].sort()

    facet_fields = sorted(facet_shards.keys())
    languages = sorted(stats_by_language.keys()) if stats_by_language else [config.default_language]

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
    if config.fuzzy:
        for language, term_shard in term_shards.items():
            fuzzy_shards[language] = build_fuzzy_shard(term_shard, config.fuzzy_max_edits)

    manifest_fields = {
        name: {
            "indexed": definition.indexed,
            "stored": definition.stored,
            **({"boost": definition.boost} if definition.indexed else {}),
        }
        for name, definition in sorted(config.field_definitions.items())
    }

    manifest = {
        "version": 1,
        "buildId": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "format": "json",
        "languages": languages,
        "defaultLanguage": config.default_language,
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

    return BuiltIndex(
        manifest=manifest,
        term_shards=term_shards,
        doc_store=doc_store,
        id_range=id_range,
        facet_shards=facet_shards,
        pins_shards=pins_shards,
        synonym_shards=build_synonym_shards(config.synonyms),
        fuzzy_shards=fuzzy_shards,
        structured=config.structured,
        pin_warnings=pin_warnings,
    )


def build_index_documents(
    documents: Iterable[IndexDocument],
    *,
    field_definitions: dict[str, FieldDefinition],
    default_language: str = "en",
    synonyms: dict[str, dict[str, Any]] | None = None,
    fuzzy: bool = False,
    fuzzy_max_edits: int = 1,
) -> BuiltIndex:
    _validate_field_definitions(field_definitions)
    copied_definitions = _copy_field_definitions(field_definitions)
    prepared = []
    for document in documents:
        copied_document = _copy_document(document)
        prepared.append(_PreparedDocument(document=copied_document))
    return _build_prepared_documents(
        prepared,
        BuildConfig(
            field_definitions=copied_definitions,
            default_language=default_language,
            synonyms=synonyms,
            fuzzy=fuzzy,
            fuzzy_max_edits=fuzzy_max_edits,
            content_hash=True,
            structured=True,
        ),
    )


def _legacy_field_definitions(
    field_boosts: dict[str, float] | None,
    *,
    include_page_title: bool = False,
) -> dict[str, FieldDefinition]:
    boosts = {**_DEFAULT_FIELD_BOOSTS, **(field_boosts or {})}
    definitions = {
        "title": FieldDefinition(indexed=True, stored=True, boost=boosts["title"]),
        "body": FieldDefinition(indexed=True, stored=False, boost=boosts["body"]),
        "excerpt": FieldDefinition(indexed=False, stored=True, boost=1.0),
    }
    if include_page_title:
        definitions["pageTitle"] = FieldDefinition(indexed=True, stored=True, boost=1.0)
    return definitions


def _normalize_section_config(
    section_indexing: SectionIndexingConfig | dict[str, Any] | None,
) -> SectionIndexingConfig | None:
    if section_indexing is None:
        return None
    config = (
        section_indexing
        if isinstance(section_indexing, SectionIndexingConfig)
        else SectionIndexingConfig(
            selectors=tuple(section_indexing.get("selectors", ("h2", "h3"))),
            mode=section_indexing.get("mode", "sections"),
        )
    )
    valid_levels = {"h1", "h2", "h3", "h4", "h5", "h6"}
    if not config.selectors:
        raise ValueError("section_indexing selectors must be non-empty")
    if not all(isinstance(s, str) and s in valid_levels for s in config.selectors):
        raise ValueError(
            "section_indexing selectors must contain only heading element "
            f"selectors (h1..h6), got {config.selectors!r}"
        )
    if config.mode not in ("sections", "page-and-sections"):
        raise ValueError(
            f"invalid section_indexing mode {config.mode!r} -- must be "
            '"sections" or "page-and-sections"'
        )
    return config


def _page_prepared_document(
    source_id: int,
    extracted: ExtractedDocument,
    *,
    body: str | None = None,
    tag_as_page: bool = False,
) -> _PreparedDocument:
    body = extracted.body if body is None else body
    metadata: dict[str, JsonValue] = (
        {"documentType": "page", **extracted.metadata} if tag_as_page else dict(extracted.metadata)
    )
    document = IndexDocument(
        id=source_id,
        external_id=None,
        url=extracted.url,
        language=extracted.language,
        indexed_fields={"title": extracted.title, "body": body},
        stored_fields={
            "title": extracted.title,
            "excerpt": extracted.excerpt or _derive_excerpt(body),
        },
        metadata=metadata,
        boost=extracted.boost,
    )
    return _PreparedDocument(
        document=document,
        facets=extracted.facets,
        range_facets=extracted.range_facets,
        pins=extracted.pins,
    )


def _section_prepared_document(
    section: ExtractedSection,
    *,
    doc_id: int,
    language: str,
    boost: float,
    facets: dict[str, list[str]],
    range_facets: dict[str, float],
    page_metadata: dict[str, str],
) -> _PreparedDocument:
    metadata: dict[str, JsonValue] = {
        "documentType": "section",
        "pageTitle": section.page_title,
        "headingLevel": section.heading_level,
        "anchor": section.anchor,
        **page_metadata,
    }
    document = IndexDocument(
        id=doc_id,
        external_id=section.url,
        url=section.url,
        language=language,
        indexed_fields={
            "title": section.title,
            "body": section.body,
            "pageTitle": section.page_title,
        },
        stored_fields={
            "title": section.title,
            "excerpt": _derive_excerpt(section.body),
            "pageTitle": section.page_title,
        },
        metadata=metadata,
        boost=boost,
    )
    return _PreparedDocument(
        document=document,
        facets=dict(facets),
        range_facets=dict(range_facets),
        pins=[],
    )


def _prepare_html_items(
    source: SourceDocument,
    section_config: SectionIndexingConfig | None,
    default_language: str,
    allowed_url_origins: list[str] | None,
    canonical_base_url: str | None,
    next_section_id: int,
) -> tuple[list[_PreparedDocument], int]:
    tree = HTMLParser(source.html)
    extracted = _extract(
        tree, source.url, default_language, allowed_url_origins, canonical_base_url
    )
    if extracted.noindex:
        return [], next_section_id

    if section_config is None:
        return [_page_prepared_document(source.id, extracted)], next_section_id

    sections = extract_sections(tree, extracted.url, extracted.title, section_config.selectors)

    if section_config.mode == "page-and-sections":
        items = [_page_prepared_document(source.id, extracted, tag_as_page=True)]
        all_sections = sections
    elif sections:
        items = []
        pre_section = extract_pre_section_body(tree, section_config.selectors)
        if pre_section:
            items.append(
                _page_prepared_document(source.id, extracted, body=pre_section, tag_as_page=True)
            )
        all_sections = sections
    else:
        return [_page_prepared_document(source.id, extracted, tag_as_page=True)], next_section_id

    def make_section(section: ExtractedSection, doc_id: int) -> _PreparedDocument:
        return _section_prepared_document(
            section,
            doc_id=doc_id,
            language=extracted.language,
            boost=extracted.boost,
            facets=extracted.facets,
            range_facets=extracted.range_facets,
            page_metadata=extracted.metadata,
        )

    for index, section in enumerate(all_sections):
        items.append(make_section(section, next_section_id + index))
    return items, next_section_id + len(all_sections)


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
    section_indexing: SectionIndexingConfig | dict[str, Any] | None = None,
) -> BuiltIndex:
    _validate_source_ids(sources)

    section_config = _normalize_section_config(section_indexing)
    field_definitions = _legacy_field_definitions(
        field_boosts, include_page_title=section_config is not None
    )

    prepared: list[_PreparedDocument] = []
    next_section_id = (max((s.id for s in sources), default=-1)) + 1
    for source in sources:
        items, next_section_id = _prepare_html_items(
            source,
            section_config,
            default_language,
            allowed_url_origins,
            canonical_base_url,
            next_section_id,
        )
        prepared.extend(items)

    return _build_prepared_documents(
        prepared,
        BuildConfig(
            field_definitions=field_definitions,
            default_language=default_language,
            hierarchical_facets=hierarchical_facets,
            range_facet_buckets=range_facet_buckets,
            synonyms=synonyms,
            fuzzy=fuzzy,
            fuzzy_max_edits=fuzzy_max_edits,
            content_hash=False,
            structured=False,
        ),
    )
