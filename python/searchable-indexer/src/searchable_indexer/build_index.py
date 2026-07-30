import datetime
import math
import sys
from typing import Callable

from searchable_analysis import analyze, get_language_profile, normalize_phrase
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
from searchable_indexer.types import BuiltIndex, SourceDocument
from searchable_indexer.vectors import build_vector_shards

_DEFAULT_FIELD_BOOSTS = {"title": 3.0, "body": 1.0}
_EXCERPT_LENGTH = 200


def _validate_source_ids(sources: list[SourceDocument]) -> None:
    seen: set[int] = set()
    for source in sources:
        if not isinstance(source.id, int) or isinstance(source.id, bool) or source.id < 0:
            raise ValueError(
                f"build_index: invalid document id {source.id!r} for "
                f'"{source.url}" -- ids must be non-negative integers'
            )
        if source.id in seen:
            raise ValueError(
                f"build_index: duplicate document id {source.id} "
                f'(seen again at "{source.url}") -- every source document '
                "must have a unique id"
            )
        seen.add(source.id)


def _derive_excerpt(body: str) -> str:
    if len(body) <= _EXCERPT_LENGTH:
        return body
    return body[:_EXCERPT_LENGTH].rstrip() + "…"


def _validate_range_facet_buckets(range_facet_buckets: dict[str, int | list[float]]) -> None:
    for field_name, config in range_facet_buckets.items():
        if isinstance(config, list):
            if len(config) < 1 or not all(math.isfinite(n) for n in config):
                raise ValueError(
                    f"build_index: invalid range_facet_buckets boundaries {config!r} "
                    f'for field "{field_name}" -- must be a non-empty list of finite numbers'
                )
            for i in range(1, len(config)):
                if config[i] <= config[i - 1]:
                    raise ValueError(
                        f"build_index: invalid range_facet_buckets boundaries {config!r} "
                        f'for field "{field_name}" -- must be strictly ascending'
                    )
        else:
            if not isinstance(config, int) or isinstance(config, bool) or config < 1:
                raise ValueError(
                    f"build_index: invalid range_facet_buckets count {config!r} "
                    f'for field "{field_name}" -- must be a positive integer'
                )


def _add_postings(shard, posting_index, field_name, doc_id, doc_boost, tokens) -> None:
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


def build_index(
    sources: list[SourceDocument],
    default_language: str = "en",
    field_boosts: dict[str, float] | None = None,
    allowed_url_origins: list[str] | None = None,
    canonical_base_url: str | None = None,
    hierarchical_facets: dict[str, dict] | None = None,
    range_facet_buckets: dict[str, int | list[float]] | None = None,
    synonyms: dict[str, dict] | None = None,
    fuzzy: bool = False,
    fuzzy_max_edits: int = 1,
    embed: Callable[[list[str]], list[list[float]]] | None = None,
    embedding_provider: dict | None = None,
    vector_quantization: str = "int8",
    vector_window: int = 200,
    vector_overlap: int = 20,
) -> BuiltIndex:
    _validate_source_ids(sources)
    boosts = {**_DEFAULT_FIELD_BOOSTS, **(field_boosts or {})}
    hierarchical_facets = hierarchical_facets or {}
    range_facet_buckets = range_facet_buckets or {}
    _validate_range_facet_buckets(range_facet_buckets)
    if fuzzy_max_edits not in (1, 2):
        raise ValueError(
            f"build_index: invalid fuzzy_max_edits {fuzzy_max_edits!r} -- must be 1 or 2"
        )
    if embed is not None and embedding_provider is None:
        raise ValueError(
            "build_index: embedding_provider is required when embed is set -- "
            "query-time provider compatibility (SearchClientOptions.embedQuery) "
            "can't be established without it"
        )
    if vector_quantization not in ("int8", "float32"):
        raise ValueError(
            f"build_index: invalid vector_quantization {vector_quantization!r} "
            '-- must be "int8" or "float32"'
        )
    if vector_window <= 0:
        raise ValueError(
            f"build_index: invalid vector_window {vector_window!r} -- must be a "
            "positive integer"
        )
    if vector_overlap < 0 or vector_overlap >= vector_window:
        raise ValueError(
            f"build_index: invalid vector_overlap {vector_overlap!r} -- must be "
            f">= 0 and < vector_window ({vector_window!r})"
        )

    term_shards: dict[str, dict] = {}
    posting_index_by_language: dict[str, dict] = {}
    doc_store: dict = {}
    facet_shards: dict[str, dict] = {}
    pins_acc_by_language: dict[str, dict] = {}
    stats_by_language: dict[str, dict] = {}
    vector_documents: list[tuple[int, str, str]] = []
    indexed_count = 0
    min_id: int | None = None
    max_id: int | None = None

    for source in sources:
        extracted = extract_document(
            source.html,
            source.url,
            default_language,
            allowed_url_origins=allowed_url_origins,
            canonical_base_url=canonical_base_url,
        )
        if extracted.noindex:
            continue

        language = extracted.language
        profile = get_language_profile(language)

        title_tokens = analyze(extracted.title, profile)
        body_tokens = analyze(extracted.body, profile)

        stats = stats_by_language.setdefault(
            language, {"title": 0, "body": 0, "count": 0}
        )
        stats["title"] += len(title_tokens)
        stats["body"] += len(body_tokens)
        stats["count"] += 1

        term_shard = term_shards.setdefault(language, {})
        posting_index = posting_index_by_language.setdefault(language, {})
        _add_postings(
            term_shard, posting_index, "title", source.id, extracted.boost, title_tokens
        )
        _add_postings(
            term_shard, posting_index, "body", source.id, extracted.boost, body_tokens
        )

        add_facet_values(facet_shards, extracted.facets, source.id, hierarchical_facets)
        add_range_facet_values(facet_shards, extracted.range_facets, source.id)

        if extracted.pins:
            pins_acc = pins_acc_by_language.setdefault(language, {})
            for pin in extracted.pins:
                normalized = normalize_phrase(pin.phrase, profile)
                if not normalized:
                    continue
                acc = pins_acc.setdefault(normalized, {"mode": pin.mode, "docs": []})
                acc["docs"].append(
                    {
                        "id": source.id,
                        "priority": pin.priority,
                        "exclusive": pin.exclusive,
                        "boost": extracted.boost,
                    }
                )

        entry: dict = {
            "url": extracted.url,
            "fields": {
                "title": extracted.title,
                "excerpt": extracted.excerpt or _derive_excerpt(extracted.body),
            },
        }
        if extracted.boost != 1.0:
            entry["boost"] = extracted.boost
        doc_store[str(source.id)] = entry

        if embed is not None:
            vector_documents.append((source.id, language, extracted.body))

        indexed_count += 1
        min_id = source.id if min_id is None else min(min_id, source.id)
        max_id = source.id if max_id is None else max(max_id, source.id)

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
        stats = stats_by_language.get(language)
        count = stats["count"] if stats else 0
        doc_count[language] = count
        avg_field_length[language] = {
            "title": (stats["title"] / count) if stats and count else 0.0,
            "body": (stats["body"] / count) if stats and count else 0.0,
        }

    fuzzy_shards: dict[str, dict] = {}
    if fuzzy:
        for language, term_shard in term_shards.items():
            fuzzy_shards[language] = build_fuzzy_shard(term_shard, fuzzy_max_edits)

    manifest = {
        "version": 1,
        "buildId": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "format": "json",
        "languages": languages,
        "defaultLanguage": default_language,
        "fields": {
            "title": {"boost": boosts["title"], "stored": True},
            "body": {"boost": boosts["body"], "stored": False},
        },
        **({"facetFields": facet_fields} if facet_fields else {}),
        "docCount": doc_count,
        "avgFieldLength": avg_field_length,
        "shards": {"terms": [], "docs": []},
    }

    id_range = (min_id, max_id) if indexed_count else (0, 0)

    vector_shards: dict[str, dict] = {}
    if embed is not None and vector_documents:
        vector_shards = build_vector_shards(
            vector_documents,
            embed,
            quantization=vector_quantization,
            window=vector_window,
            overlap=vector_overlap,
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
    )
