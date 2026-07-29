from dataclasses import dataclass, field
from typing import Any

from searchable_analysis import get_language_profile  # type: ignore[import-untyped]

from searchable_client.fetch import ShardCache, resolve_url
from searchable_client.parse_query import parse_query
from searchable_client.score import score_term_for_doc
from searchable_client.types import (
    DocStoreEntry,
    Manifest,
    TermEntry,
    TermShardEntry,
    doc_store_shard_from_dict,
    term_shard_from_dict,
)

UNSHARDED_TERM_SHARD_PREFIX = "all"
DEFAULT_SYNONYM_WEIGHT = 0.5
DEFAULT_FUZZY_WEIGHT = 0.5
MAX_SUGGESTIONS_PER_TERM = 3


@dataclass
class Hit:
    id: int
    score: float
    url: str
    fields: dict[str, str]
    pinned: bool = False
    highlights: dict[str, list[Any]] | None = None


@dataclass
class SearchResult:
    hits: list[Hit]
    total_hits: int
    language: str
    facets: dict[str, Any] | None = None
    did_you_mean: list[str] | None = None


@dataclass
class SearchOptions:
    language: str | None = None
    limit: int = 10
    boosts: dict[str, Any] | None = None  # {"fields": {...}, "terms": {...}}
    filters: dict[str, Any] | None = None
    facets: list[str] = field(default_factory=list)
    synonyms: bool = False
    synonym_weight: float = DEFAULT_SYNONYM_WEIGHT
    fuzzy: bool = False
    fuzzy_weight: float = DEFAULT_FUZZY_WEIGHT
    highlight: bool = False


def _shard_entries_for_query(
    shard_entries: list[TermShardEntry], exact_terms_needed: set[str], prefixes_needed: list[str]
) -> list[TermShardEntry]:
    result = []
    for entry in shard_entries:
        if entry.prefix == UNSHARDED_TERM_SHARD_PREFIX:
            result.append(entry)
            continue
        if any(term.startswith(entry.prefix) for term in exact_terms_needed):
            result.append(entry)
            continue
        if any(entry.prefix.startswith(p) or p.startswith(entry.prefix) for p in prefixes_needed):
            result.append(entry)
    return result


def _fetch_doc_store_entries_by_ids(
    manifest: Manifest, cache: ShardCache, base_url: str, ids: list[int]
) -> dict[int, DocStoreEntry]:
    doc_lookup: dict[int, DocStoreEntry] = {}
    id_set = set(ids)
    for entry in manifest.shards_docs:
        if not any(entry.id_range[0] <= i <= entry.id_range[1] for i in ids):
            continue
        if entry.format == "binary":
            from searchable_client.binary_doc_store import (
                decode_binary_doc_store_directory,
                decode_binary_doc_store_entry,
            )

            data = cache.fetch_bytes(resolve_url(base_url, entry.file))
            _, index, dir_len = decode_binary_doc_store_directory(data)
            for doc_id in id_set:
                location = index.get(doc_id)
                if location:
                    doc_lookup[doc_id] = decode_binary_doc_store_entry(data, dir_len, location[0])
        else:
            shard = doc_store_shard_from_dict(cache.fetch_json(resolve_url(base_url, entry.file)))
            for doc_id, doc_entry in shard.items():
                if doc_id in id_set:
                    doc_lookup[doc_id] = doc_entry
    return doc_lookup


def search(
    query: str,
    manifest: Manifest,
    cache: ShardCache,
    base_url: str,
    options: SearchOptions | None = None,
) -> SearchResult:
    options = options or SearchOptions()
    language = options.language or manifest.default_language
    profile = get_language_profile(language)

    parsed_query = parse_query(query, profile)
    query_terms = parsed_query.terms
    if not query_terms and not parsed_query.phrases:
        return SearchResult(hits=[], total_hits=0, language=language)

    shard_entries = [s for s in manifest.shards_terms if s.lang == language]

    exact_terms_needed: set[str] = set()
    prefixes_needed: list[str] = []
    for qt in query_terms:
        if qt.prefix:
            prefixes_needed.append(qt.term)
        else:
            exact_terms_needed.add(qt.term)

    needed_shard_entries = _shard_entries_for_query(
        shard_entries, exact_terms_needed, prefixes_needed
    )
    term_lookup: dict[str, TermEntry] = {}
    for entry in needed_shard_entries:
        if entry.format == "binary":
            from searchable_client.binary_term_shard import (
                decode_binary_term_entry,
                decode_binary_term_shard_directory,
                terms_with_binary_prefix,
            )

            data = cache.fetch_bytes(resolve_url(base_url, entry.file))
            sorted_terms, index, dir_len = decode_binary_term_shard_directory(data)
            terms_to_decode: set[str] = {t for t in exact_terms_needed if t in index}
            for p in prefixes_needed:
                terms_to_decode.update(terms_with_binary_prefix(sorted_terms, p))
            for term in terms_to_decode:
                location = index.get(term)
                if location:
                    term_lookup[term] = decode_binary_term_entry(data, dir_len, location[0])
        else:
            shard = term_shard_from_dict(cache.fetch_json(resolve_url(base_url, entry.file)))
            term_lookup.update(shard)

    # AND is over *distinct query term slots*: build one doc-id set per query term,
    # merging all prefix-matched entries for that slot with OR (since "wid*" means
    # "any term starting with wid"), then intersect the per-slot sets.
    clauses: list[tuple[str, TermEntry]] = []
    term_slot_doc_sets: list[set[int]] = []
    any_clause_failed = False
    for qt in query_terms:
        slot_ids: set[int] = set()
        if qt.prefix:
            matched = [
                (term, term_entry)
                for term, term_entry in term_lookup.items()
                if term.startswith(qt.term)
            ]
            if not matched:
                any_clause_failed = True
            for _term, term_entry in matched:
                slot_ids.update(p.doc for p in term_entry.postings)
            clauses.extend(matched)
        else:
            exact_entry = term_lookup.get(qt.term)
            if exact_entry is None:
                any_clause_failed = True
            else:
                slot_ids.update(p.doc for p in exact_entry.postings)
                clauses.append((qt.term, exact_entry))
        term_slot_doc_sets.append(slot_ids)

    organic_candidate_ids: list[int] = []
    if not any_clause_failed and term_slot_doc_sets:
        organic_candidate_ids = list(set.intersection(*term_slot_doc_sets))

    candidate_ids = organic_candidate_ids
    limit = options.limit
    field_boosts = (options.boosts or {}).get("fields")
    term_boosts = (options.boosts or {}).get("terms", {})
    ranked = sorted(
        (
            (
                doc_id,
                sum(
                    score_term_for_doc(posting, entry.df, manifest, language, field_boosts)
                    * term_boosts.get(term, 1.0)
                    for term, entry in clauses
                    for posting in entry.postings
                    if posting.doc == doc_id
                ),
            )
            for doc_id in candidate_ids
        ),
        key=lambda pair: -pair[1],
    )[:limit]

    doc_lookup = _fetch_doc_store_entries_by_ids(
        manifest, cache, base_url, [doc_id for doc_id, _ in ranked]
    )
    hits = [
        Hit(
            id=doc_id,
            score=doc_score,
            url=(doc_lookup[doc_id].url if doc_id in doc_lookup else ""),
            fields=(doc_lookup[doc_id].fields if doc_id in doc_lookup else {}),
        )
        for doc_id, doc_score in ranked
    ]

    return SearchResult(hits=hits, total_hits=len(candidate_ids), language=language)
