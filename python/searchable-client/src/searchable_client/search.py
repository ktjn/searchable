from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field, replace
from math import isfinite
from typing import Any

from searchable_analysis import (  # type: ignore[import-untyped]
    generate_deletes,
    get_language_profile,
    normalize_phrase,
)

from searchable_client.errors import (
    InvalidVectorShardError,
    VectorSearchNotConfiguredError,
    VectorUnavailableError,
)
from searchable_client.fetch import ShardCache, resolve_url
from searchable_client.highlight import HighlightSpan, HighlightTerm, highlight_text
from searchable_client.parse_query import parse_query
from searchable_client.score import score_term_for_doc
from searchable_client.types import (
    DocStoreEntry,
    FacetShard,
    Manifest,
    SynonymShard,
    TermEntry,
    TermShardEntry,
    doc_store_shard_from_dict,
    facet_shard_from_dict,
    fuzzy_shard_from_dict,
    pins_shard_from_dict,
    synonym_shard_from_dict,
    term_shard_from_dict,
    vector_shard_from_dict,
)
from searchable_client.vectors import VectorHit, brute_force_vector_search, reciprocal_rank_fusion

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
    highlights: dict[str, list[HighlightSpan]] | None = None
    external_id: str | None = None
    metadata: dict[str, Any] | None = None
    content_hash: str | None = None


@dataclass
class SearchResult:
    hits: list[Hit]
    total_hits: int
    language: str
    facets: "dict[str, FacetResult] | None" = None
    did_you_mean: list[str] | None = None


@dataclass
class SearchOptions:
    language: str | None = None
    limit: int = 10
    mode: str = "lexical"
    operator: str = "and"
    vector_weight: float | None = None
    boosts: dict[str, Any] | None = None  # {"fields": {...}, "terms": {...}}
    filters: dict[str, Any] | None = None
    facets: list[str] = field(default_factory=list)
    synonyms: bool = False
    synonym_weight: float = DEFAULT_SYNONYM_WEIGHT
    fuzzy: bool = False
    fuzzy_weight: float = DEFAULT_FUZZY_WEIGHT
    highlight: bool = False


@dataclass
class FacetResultValue:
    value: str
    count: int
    selected: bool


@dataclass
class FacetResult:
    values: list[FacetResultValue]
    separator: str | None = None


@dataclass
class FacetValuesOptions:
    filters: dict[str, Any] | None = None


def _is_range_filter(value: Any) -> bool:
    return isinstance(value, dict) and ("min" in value or "max" in value)


def _values_for(filters: dict[str, Any] | None, field_name: str) -> list[str]:
    raw = (filters or {}).get(field_name)
    if raw is None or _is_range_filter(raw):
        return []
    return raw if isinstance(raw, list) else [raw]


def _range_filter_for(filters: dict[str, Any] | None, field_name: str) -> dict[str, Any] | None:
    raw = (filters or {}).get(field_name)
    return raw if _is_range_filter(raw) else None


def _fetch_facet_shards(
    manifest: Manifest, cache: ShardCache, base_url: str, fields: list[str]
) -> dict[str, FacetShard]:
    result = {}
    for entry in manifest.shards_facets:
        if entry.field in fields:
            raw = cache.fetch_json(resolve_url(base_url, entry.file))
            result[entry.field] = facet_shard_from_dict(raw)
    return result


def _union_docs_for_field(
    facet_shards_by_field: dict[str, FacetShard], filters: dict[str, Any] | None, field_name: str
) -> set[int]:
    shard = facet_shards_by_field.get(field_name)
    if shard is None:
        return set()
    ids: set[int] = set()
    if shard.type == "range":
        range_filter = _range_filter_for(filters, field_name)
        if not range_filter:
            return ids
        for range_entry in shard.sorted or []:
            if (
                "min" in range_filter
                and range_filter["min"] is not None
                and range_entry.value < range_filter["min"]
            ):
                continue
            if (
                "max" in range_filter
                and range_filter["max"] is not None
                and range_entry.value > range_filter["max"]
            ):
                continue
            ids.add(range_entry.doc)
        return ids
    for value in _values_for(filters, field_name):
        value_entry = shard.values.get(value)
        if value_entry:
            ids.update(value_entry.docs)
    return ids


def facet_values(
    field: str,
    manifest: Manifest,
    cache: ShardCache,
    base_url: str,
    options: FacetValuesOptions | None = None,
) -> FacetResult:
    options = options or FacetValuesOptions()
    other_filter_fields = [f for f in (options.filters or {}) if f != field]
    needed_fields = list({field, *other_filter_fields})
    facet_shards_by_field = _fetch_facet_shards(manifest, cache, base_url, needed_fields)

    shard = facet_shards_by_field.get(field)
    if shard is None:
        return FacetResult(values=[])

    base_set: set[int] | None = None
    for f in other_filter_fields:
        if f not in facet_shards_by_field:
            continue
        union_set = _union_docs_for_field(facet_shards_by_field, options.filters, f)
        base_set = union_set if base_set is None else (base_set & union_set)

    selected_values = set(_values_for(options.filters, field))
    return FacetResult(
        values=[
            FacetResultValue(
                value=value,
                count=(
                    len([i for i in entry.docs if i in base_set])
                    if base_set is not None
                    else entry.count
                ),
                selected=value in selected_values,
            )
            for value, entry in shard.values.items()
        ],
        separator=(shard.separator or ">") if shard.type == "hierarchy" else None,
    )


def _synonym_variants_for(term: str, synonym_shard: SynonymShard | None) -> list[str]:
    if synonym_shard is None:
        return []
    variants: set[str] = set()
    for group in synonym_shard.equivalences:
        if term in group:
            variants.update(v for v in group if v != term)
    variants.update(synonym_shard.directional.get(term, []))
    return list(variants)


def _levenshtein_distance(a: str, b: str) -> int:
    s, t = list(a), list(b)
    prev_row = list(range(len(t) + 1))
    for i in range(1, len(s) + 1):
        diag = prev_row[0]
        prev_row[0] = i
        for j in range(1, len(t) + 1):
            temp = prev_row[j]
            prev_row[j] = (
                diag if s[i - 1] == t[j - 1] else 1 + min(diag, prev_row[j], prev_row[j - 1])
            )
            diag = temp
    return prev_row[len(t)]


MAX_FUZZY_CANDIDATES_PER_TERM = 200


class _FuzzyLookup:
    def __init__(self, max_edits: int, deletions: dict[str, list[str]]):
        self.max_edits = max_edits
        self._deletions = deletions

    def get(self, variant: str) -> list[str]:
        return self._deletions.get(variant, [])


def _fuzzy_candidates_for(term: str, lookup: "_FuzzyLookup | None") -> list[tuple[str, int]]:
    if lookup is None:
        return []
    candidates: set[str] = set(lookup.get(term))
    for deletion in generate_deletes(term, lookup.max_edits):
        candidates.update(lookup.get(deletion))
    candidate_terms = list(candidates)[:MAX_FUZZY_CANDIDATES_PER_TERM]
    return [(c, _levenshtein_distance(term, c)) for c in candidate_terms if c != term]


def _effective_max_edits(term: str, shard_max_edits: int) -> int:
    return min(1, shard_max_edits) if len(term) <= 3 else shard_max_edits


def _fuzzy_matches_for(term: str, lookup: "_FuzzyLookup | None") -> list[tuple[str, int]]:
    if lookup is None:
        return []
    cap = _effective_max_edits(term, lookup.max_edits)
    return [m for m in _fuzzy_candidates_for(term, lookup) if m[1] <= cap]


def _nearest_terms_for(term: str, lookup: "_FuzzyLookup | None", limit: int) -> list[str]:
    matches = sorted(_fuzzy_candidates_for(term, lookup), key=lambda m: (m[1], m[0]))
    return [m[0] for m in matches[:limit]]


def _load_fuzzy_lookup(
    manifest: Manifest, cache: ShardCache, base_url: str, language: str
) -> "_FuzzyLookup | None":
    entry = (manifest.fuzzy or {}).get(language)
    if entry is None:
        return None
    if entry.format == "binary":
        from searchable_client.binary_fuzzy_shard import (
            decode_binary_fuzzy_entry,
            decode_binary_fuzzy_shard_directory,
        )

        data = cache.fetch_bytes(resolve_url(base_url, entry.file))
        max_edits, _, index, dir_len = decode_binary_fuzzy_shard_directory(data)

        class _BinaryFuzzyLookup(_FuzzyLookup):
            def __init__(self) -> None:
                self.max_edits = max_edits

            def get(self, variant: str) -> list[str]:
                location = index.get(variant)
                return decode_binary_fuzzy_entry(data, dir_len, location[0]) if location else []

        return _BinaryFuzzyLookup()
    shard = fuzzy_shard_from_dict(cache.fetch_json(resolve_url(base_url, entry.file)))
    return _FuzzyLookup(shard.max_edits, shard.deletions)


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


def _has_consecutive_positions(entries: list[TermEntry | None], doc_id: int) -> bool:
    postings = [
        next((p for p in e.postings if p.doc == doc_id), None) if e else None for e in entries
    ]
    if not postings or any(p is None for p in postings):
        return False
    first = postings[0]
    assert first is not None
    for field_name in first.fields:
        position_sets = [
            p.fields[field_name].pos if p is not None and field_name in p.fields else None
            for p in postings
        ]
        if any(s is None for s in position_sets):
            continue
        start_positions = position_sets[0]
        assert start_positions is not None
        for start in start_positions:
            if all(start + i in (position_sets[i] or []) for i in range(1, len(position_sets))):
                return True
    return False


def _contains_phrase(query_tokens: list[str], phrase_tokens: list[str]) -> bool:
    if not phrase_tokens or len(phrase_tokens) > len(query_tokens):
        return False
    for i in range(len(query_tokens) - len(phrase_tokens) + 1):
        if all(query_tokens[i + j] == t for j, t in enumerate(phrase_tokens)):
            return True
    return False


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
            _, index, dir_len = decode_binary_doc_store_directory(
                data, binary_version=entry.binary_version
            )
            for doc_id in id_set:
                location = index.get(doc_id)
                if location:
                    doc_lookup[doc_id] = decode_binary_doc_store_entry(
                        data, dir_len, location[0], binary_version=entry.binary_version or 1
                    )
        else:
            shard = doc_store_shard_from_dict(cache.fetch_json(resolve_url(base_url, entry.file)))
            for doc_id, doc_entry in shard.items():
                if doc_id in id_set:
                    doc_lookup[doc_id] = doc_entry
    return doc_lookup


def _load_vector_hits(
    manifest: Manifest,
    cache: ShardCache,
    base_url: str,
    language: str,
    query_vector: list[float],
    limit: int,
) -> list["VectorHit"]:
    vectors = manifest.vectors
    if vectors is None or language not in vectors.shards:
        raise VectorUnavailableError(f"no vector shard is configured for language {language!r}")
    try:
        shard = vector_shard_from_dict(
            cache.fetch_json(resolve_url(base_url, vectors.shards[language]))
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise InvalidVectorShardError(
            f"could not parse vector shard for {language!r}: {exc}"
        ) from exc
    if shard.dims != vectors.dims:
        raise InvalidVectorShardError(
            f"vector shard dims {shard.dims} do not match manifest dims {vectors.dims}"
        )
    if shard.quantization != vectors.quantization:
        raise InvalidVectorShardError(
            f"vector shard quantization {shard.quantization!r} does not match manifest "
            f"quantization {vectors.quantization!r}"
        )
    if shard.quantization == "int8" and shard.quant_range is None:
        raise InvalidVectorShardError("int8 vector shard requires quantRange")
    for entry in shard.entries:
        if len(entry.vector) != shard.dims:
            raise InvalidVectorShardError(
                f"vector entry {entry.passage_id!r} has {len(entry.vector)} dims; "
                f"shard requires {shard.dims}"
            )
        if not all(isfinite(value) for value in entry.vector):
            raise InvalidVectorShardError(
                f"vector entry {entry.passage_id!r} contains non-finite values"
            )
    return brute_force_vector_search(query_vector, shard, limit)


def _vector_hit_result(
    vector_hits: list["VectorHit"],
    manifest: Manifest,
    cache: ShardCache,
    base_url: str,
    options: SearchOptions,
    language: str,
) -> SearchResult:
    ids = [hit.doc_id for hit in vector_hits]
    doc_lookup = _fetch_doc_store_entries_by_ids(manifest, cache, base_url, ids)
    hits = [
        Hit(
            id=vector_hit.doc_id,
            score=vector_hit.score,
            url=doc_lookup[vector_hit.doc_id].url if vector_hit.doc_id in doc_lookup else "",
            fields=doc_lookup[vector_hit.doc_id].fields if vector_hit.doc_id in doc_lookup else {},
            external_id=(
                doc_lookup[vector_hit.doc_id].external_id
                if vector_hit.doc_id in doc_lookup
                else None
            ),
            metadata=(
                doc_lookup[vector_hit.doc_id].metadata if vector_hit.doc_id in doc_lookup else None
            ),
            content_hash=(
                doc_lookup[vector_hit.doc_id].content_hash
                if vector_hit.doc_id in doc_lookup
                else None
            ),
        )
        for vector_hit in vector_hits
    ]
    return SearchResult(hits=hits, total_hits=len(vector_hits), language=language)


def _normalize_scores(scores: list[float]) -> dict[float, float]:
    if not scores:
        return {}
    minimum, maximum = min(scores), max(scores)
    if minimum == maximum:
        return {score: 1.0 for score in scores}
    return {score: (score - minimum) / (maximum - minimum) for score in scores}


def _vector_or_hybrid_search(
    query: str,
    manifest: Manifest,
    cache: ShardCache,
    base_url: str,
    options: SearchOptions,
    query_vector: list[float] | None,
    language: str,
) -> SearchResult:
    if query_vector is None:
        raise VectorSearchNotConfiguredError(
            f'Search mode "{options.mode}" requires a query vector'
        )
    limit = max(0, options.limit)
    candidate_limit = max(limit * 3, limit)
    vector_hits = _load_vector_hits(
        manifest, cache, base_url, language, query_vector, candidate_limit
    )
    if options.mode == "vector":
        return _vector_hit_result(vector_hits[:limit], manifest, cache, base_url, options, language)

    lexical_options = replace(options, mode="lexical", vector_weight=None, limit=candidate_limit)
    lexical_result = search(query, manifest, cache, base_url, lexical_options)
    lexical_by_id = {hit.id: hit for hit in lexical_result.hits}
    vector_by_id = {hit.doc_id: hit for hit in vector_hits}
    lexical_ids = list(lexical_by_id)
    vector_ids = list(vector_by_id)
    if options.vector_weight is None:
        fused_scores = reciprocal_rank_fusion([lexical_ids, vector_ids])
    else:
        if not 0.0 <= options.vector_weight <= 1.0:
            raise ValueError("vector_weight must be between 0 and 1")
        lexical_normalized = _normalize_scores([hit.score for hit in lexical_by_id.values()])
        vector_normalized = _normalize_scores([hit.score for hit in vector_by_id.values()])
        fused_scores = {
            doc_id: (1.0 - options.vector_weight)
            * lexical_normalized.get(lexical_by_id[doc_id].score, 0.0)
            + options.vector_weight * vector_normalized.get(vector_by_id[doc_id].score, 0.0)
            for doc_id in {*lexical_by_id, *vector_by_id}
        }
    ordered_ids = sorted(fused_scores, key=lambda doc_id: (-fused_scores[doc_id], doc_id))[:limit]
    missing_ids = [doc_id for doc_id in ordered_ids if doc_id not in lexical_by_id]
    doc_lookup = _fetch_doc_store_entries_by_ids(manifest, cache, base_url, missing_ids)
    hits: list[Hit] = []
    for doc_id in ordered_ids:
        lexical_hit = lexical_by_id.get(doc_id)
        if lexical_hit is not None:
            hits.append(replace(lexical_hit, score=fused_scores[doc_id]))
            continue
        doc = doc_lookup.get(doc_id)
        hits.append(
            Hit(
                id=doc_id,
                score=fused_scores[doc_id],
                url=doc.url if doc else "",
                fields=doc.fields if doc else {},
                external_id=doc.external_id if doc else None,
                metadata=doc.metadata if doc else None,
                content_hash=doc.content_hash if doc else None,
            )
        )
    return SearchResult(
        hits=hits,
        total_hits=len(fused_scores),
        language=language,
        facets=lexical_result.facets,
        did_you_mean=lexical_result.did_you_mean,
    )


def search(
    query: str,
    manifest: Manifest,
    cache: ShardCache,
    base_url: str,
    options: SearchOptions | None = None,
    query_vector: list[float] | None = None,
) -> SearchResult:
    options = options or SearchOptions()
    language = options.language or manifest.default_language
    profile = get_language_profile(language)

    if options.mode not in ("lexical", "vector", "hybrid"):
        raise ValueError(f"unsupported search mode {options.mode!r}")
    if options.operator not in ("and", "or"):
        raise ValueError(f"unsupported operator {options.operator!r}")
    if options.mode != "lexical":
        return _vector_or_hybrid_search(
            query, manifest, cache, base_url, options, query_vector, language
        )

    parsed_query = parse_query(query, profile)
    query_terms = parsed_query.terms
    if not query_terms and not parsed_query.phrases:
        return SearchResult(hits=[], total_hits=0, language=language)

    highlight_terms = [HighlightTerm(term=qt.literal, prefix=qt.prefix) for qt in query_terms] + [
        HighlightTerm(term=qt.literal, prefix=False)
        for phrase in parsed_query.phrases
        for qt in phrase.terms
    ]

    shard_entries = [s for s in manifest.shards_terms if s.lang == language]

    synonyms_file = (manifest.synonyms or {}).get(language) if options.synonyms else None
    synonym_shard = (
        synonym_shard_from_dict(cache.fetch_json(resolve_url(base_url, synonyms_file)))
        if synonyms_file
        else None
    )
    fuzzy_lookup = (
        _load_fuzzy_lookup(manifest, cache, base_url, language) if options.fuzzy else None
    )

    exact_terms_needed: set[str] = set()
    prefixes_needed: list[str] = []
    for qt in query_terms:
        if qt.prefix:
            prefixes_needed.append(qt.term)
        else:
            exact_terms_needed.add(qt.term)
            exact_terms_needed.update(_synonym_variants_for(qt.term, synonym_shard))
            exact_terms_needed.update(t for t, _ in _fuzzy_matches_for(qt.term, fuzzy_lookup))
    for phrase_term in parsed_query.phrases:
        exact_terms_needed.update(qt.term for qt in phrase_term.terms)

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

    # Matching is over *distinct query term slots*: build one doc-id set per
    # query term, merging all prefix-matched entries for that slot with OR
    # (since "wid*" means "any term starting with wid"). options.operator
    # then decides how the per-slot sets combine: "and" (default) intersects
    # them, requiring every slot to match the same document; "or" unions
    # them, so a document matching any query term is a candidate, with
    # _score_of's per-clause summation still ranking fuller matches higher.
    clauses: list[tuple[str, TermEntry, float]] = []  # (term, entry, weight)
    term_slot_doc_sets: list[set[int]] = []
    failed_terms: list[str] = []
    for qt in query_terms:
        slot_ids: set[int] = set()
        if qt.prefix:
            matched = [
                (term, term_entry)
                for term, term_entry in term_lookup.items()
                if term.startswith(qt.term)
            ]
            for _term, term_entry in matched:
                slot_ids.update(p.doc for p in term_entry.postings)
            clauses.extend((term, term_entry, 1.0) for term, term_entry in matched)
        else:
            added_terms: set[str] = set()
            exact_entry = term_lookup.get(qt.term)
            if exact_entry is not None:
                slot_ids.update(p.doc for p in exact_entry.postings)
                clauses.append((qt.term, exact_entry, 1.0))
                added_terms.add(qt.term)
            for variant in _synonym_variants_for(qt.term, synonym_shard):
                if variant in added_terms:
                    continue
                variant_entry = term_lookup.get(variant)
                if variant_entry:
                    clauses.append((variant, variant_entry, options.synonym_weight))
                    slot_ids.update(p.doc for p in variant_entry.postings)
                    added_terms.add(variant)
            for match_term, distance in _fuzzy_matches_for(qt.term, fuzzy_lookup):
                if match_term in added_terms:
                    continue
                fuzzy_entry = term_lookup.get(match_term)
                if fuzzy_entry:
                    clauses.append((match_term, fuzzy_entry, options.fuzzy_weight**distance))
                    slot_ids.update(p.doc for p in fuzzy_entry.postings)
                    added_terms.add(match_term)
        term_slot_doc_sets.append(slot_ids)
        if not qt.prefix and not slot_ids:
            failed_terms.append(qt.term)

    phrase_doc_sets: list[set[int]] = []
    for phrase_term in parsed_query.phrases:
        phrase_words = [qt.term for qt in phrase_term.terms]
        phrase_entries = [term_lookup.get(w) for w in phrase_words]
        if any(e is None for e in phrase_entries):
            phrase_doc_sets.append(set())
            continue
        phrase_word_doc_sets = [
            set(p.doc for p in e.postings) for e in phrase_entries if e is not None
        ]
        phrase_common_ids = (
            set.intersection(*phrase_word_doc_sets) if phrase_word_doc_sets else set()
        )
        phrase_matched_ids = {
            doc_id
            for doc_id in phrase_common_ids
            if _has_consecutive_positions(phrase_entries, doc_id)
        }
        phrase_doc_sets.append(phrase_matched_ids)
        for phrase_word, phrase_entry in zip(phrase_words, phrase_entries, strict=True):
            if phrase_entry is None:
                continue
            # Note: if a phrase word also appears as a bare query term, both the plain-term
            # clause and this phrase clause contribute to its score -- intentional/acceptable.
            restricted = TermEntry(
                df=phrase_entry.df,
                postings=[p for p in phrase_entry.postings if p.doc in phrase_matched_ids],
            )
            clauses.append((phrase_word, restricted, 1.0))

    all_doc_sets = term_slot_doc_sets + phrase_doc_sets
    if not all_doc_sets:
        organic_candidate_ids = []
    elif options.operator == "or":
        organic_candidate_ids = list(set.union(*all_doc_sets))
    else:
        organic_candidate_ids = list(set.intersection(*all_doc_sets))

    filter_fields = list(options.filters or {})
    requested_facet_fields = options.facets or []
    needed_fields = list({*filter_fields, *requested_facet_fields})
    facet_shards_by_field = _fetch_facet_shards(manifest, cache, base_url, needed_fields)

    active_filter_fields = [f for f in filter_fields if f in facet_shards_by_field]
    filter_union_sets = {
        f: _union_docs_for_field(facet_shards_by_field, options.filters, f)
        for f in active_filter_fields
    }

    candidate_ids = organic_candidate_ids
    for union_set in filter_union_sets.values():
        candidate_ids = [i for i in candidate_ids if i in union_set]

    limit = options.limit
    field_boosts = (options.boosts or {}).get("fields")
    term_boosts: dict[str, float] = (options.boosts or {}).get("terms", {})

    normalized_query = normalize_phrase(query, profile)
    pins_file = (manifest.pins or {}).get(language)
    matched_pins: list[tuple[int, float, bool]] = []  # (id, priority, exclusive)
    if pins_file and normalized_query:
        pins_shard = pins_shard_from_dict(cache.fetch_json(resolve_url(base_url, pins_file)))
        query_tokens = normalized_query.split(" ")
        for phrase, pin_entry_def in pins_shard.items():
            matches = (
                phrase == normalized_query
                if pin_entry_def.mode == "exact"
                else _contains_phrase(query_tokens, phrase.split(" "))
            )
            if matches:
                matched_pins.extend((d.id, d.priority, d.exclusive) for d in pin_entry_def.docs)
        matched_pins.sort(key=lambda d: -d[1])
        seen_ids: set[int] = set()
        deduped = []
        for pin in matched_pins:
            if pin[0] not in seen_ids:
                seen_ids.add(pin[0])
                deduped.append(pin)
        matched_pins = deduped
        if active_filter_fields:
            matched_pins = [
                p
                for p in matched_pins
                if all(p[0] in filter_union_sets[f] for f in active_filter_fields)
            ]

    is_exclusive = any(p[2] for p in matched_pins)
    pinned_for_display = matched_pins[:limit]
    pinned_id_set = {p[0] for p in pinned_for_display}

    doc_boosts: dict[int, float] = {}
    for _clause_term, clause_entry, _clause_weight in clauses:
        for posting in clause_entry.postings:
            if posting.boost is not None:
                doc_boosts[posting.doc] = posting.boost

    def _score_of(doc_id: int) -> float:
        base_score = sum(
            score_term_for_doc(posting, entry.df, manifest, language, field_boosts)
            * term_boosts.get(term, 1.0)
            * weight
            for term, entry, weight in clauses
            for posting in entry.postings
            if posting.doc == doc_id
        )
        return base_score * doc_boosts.get(doc_id, 1.0)

    ranked_organic = (
        []
        if is_exclusive
        else sorted(
            (
                (doc_id, _score_of(doc_id))
                for doc_id in candidate_ids
                if doc_id not in pinned_id_set
            ),
            key=lambda pair: -pair[1],
        )[: max(0, limit - len(pinned_for_display))]
    )

    all_result_ids = [p[0] for p in pinned_for_display] + [r[0] for r in ranked_organic]
    doc_lookup = _fetch_doc_store_entries_by_ids(manifest, cache, base_url, all_result_ids)

    def _to_hit(doc_id: int, score: float, pinned: bool) -> Hit:
        doc = doc_lookup.get(doc_id)
        fields = doc.fields if doc else {}
        highlights = (
            {f: highlight_text(text, highlight_terms) for f, text in fields.items()}
            if options.highlight
            else None
        )
        return Hit(
            id=doc_id,
            score=score,
            url=doc.url if doc else "",
            fields=fields,
            external_id=doc.external_id if doc else None,
            metadata=doc.metadata if doc else None,
            content_hash=doc.content_hash if doc else None,
            pinned=pinned,
            highlights=highlights,
        )

    hits = [_to_hit(p[0], _score_of(p[0]), True) for p in pinned_for_display] + [
        _to_hit(doc_id, s, False) for doc_id, s in ranked_organic
    ]

    total_hits = (
        len(pinned_for_display)
        if is_exclusive
        else len({*candidate_ids, *(p[0] for p in pinned_for_display)})
    )

    facets: dict[str, FacetResult] | None = None
    if requested_facet_fields:
        facets = {}
        for f in requested_facet_fields:
            facet_shard = facet_shards_by_field.get(f)
            if facet_shard is None:
                continue
            base_set = set(organic_candidate_ids)
            for other_field, union_set in filter_union_sets.items():
                if other_field == f:
                    continue
                base_set &= union_set
            selected_values = set(_values_for(options.filters, f))
            facets[f] = FacetResult(
                values=[
                    FacetResultValue(
                        value=value,
                        count=len([i for i in facet_value_entry.docs if i in base_set]),
                        selected=value in selected_values,
                    )
                    for value, facet_value_entry in facet_shard.values.items()
                ],
                separator=(
                    (facet_shard.separator or ">") if facet_shard.type == "hierarchy" else None
                ),
            )

    did_you_mean: list[str] | None = None
    if options.fuzzy and fuzzy_lookup and not hits and failed_terms:
        suggestions: list[str] = []
        for term in failed_terms:
            for candidate in _nearest_terms_for(term, fuzzy_lookup, MAX_SUGGESTIONS_PER_TERM):
                if candidate not in suggestions:
                    suggestions.append(candidate)
        did_you_mean = suggestions or None

    return SearchResult(
        hits=hits,
        total_hits=total_hits,
        language=language,
        facets=facets,
        did_you_mean=did_you_mean,
    )


def retrieve(
    ids: Iterable[int],
    manifest: Manifest,
    cache: ShardCache,
    base_url: str,
) -> list[Hit]:
    requested_ids = list(ids)
    doc_lookup = _fetch_doc_store_entries_by_ids(manifest, cache, base_url, requested_ids)
    return [
        Hit(
            id=doc_id,
            score=0.0,
            url=doc_lookup[doc_id].url,
            fields=doc_lookup[doc_id].fields,
            external_id=doc_lookup[doc_id].external_id,
            metadata=doc_lookup[doc_id].metadata,
            content_hash=doc_lookup[doc_id].content_hash,
        )
        for doc_id in requested_ids
        if doc_id in doc_lookup
    ]


def search_stream(
    query: str,
    manifest: Manifest,
    cache: ShardCache,
    base_url: str,
    options: SearchOptions | None = None,
) -> Iterator[SearchResult]:
    options = options or SearchOptions()
    if not options.synonyms and not options.fuzzy:
        yield search(query, manifest, cache, base_url, options)
        return
    partial_options = replace(options, synonyms=False, fuzzy=False)
    yield search(query, manifest, cache, base_url, partial_options)
    yield search(query, manifest, cache, base_url, options)
