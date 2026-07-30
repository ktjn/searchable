from dataclasses import dataclass, field
from typing import Any

from searchable_analysis import (  # type: ignore[import-untyped]
    get_language_profile,
    normalize_phrase,
)

from searchable_client.fetch import ShardCache, resolve_url
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
    pins_shard_from_dict,
    synonym_shard_from_dict,
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
    facets: "dict[str, FacetResult] | None" = None
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

    synonyms_file = (manifest.synonyms or {}).get(language) if options.synonyms else None
    synonym_shard = (
        synonym_shard_from_dict(cache.fetch_json(resolve_url(base_url, synonyms_file)))
        if synonyms_file
        else None
    )

    exact_terms_needed: set[str] = set()
    prefixes_needed: list[str] = []
    for qt in query_terms:
        if qt.prefix:
            prefixes_needed.append(qt.term)
        else:
            exact_terms_needed.add(qt.term)
            exact_terms_needed.update(_synonym_variants_for(qt.term, synonym_shard))
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

    # AND is over *distinct query term slots*: build one doc-id set per query term,
    # merging all prefix-matched entries for that slot with OR (since "wid*" means
    # "any term starting with wid"), then intersect the per-slot sets.
    clauses: list[tuple[str, TermEntry, float]] = []  # (term, entry, weight)
    term_slot_doc_sets: list[set[int]] = []
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
            exact_entry = term_lookup.get(qt.term)
            if exact_entry is not None:
                slot_ids.update(p.doc for p in exact_entry.postings)
                clauses.append((qt.term, exact_entry, 1.0))
            for variant in _synonym_variants_for(qt.term, synonym_shard):
                variant_entry = term_lookup.get(variant)
                if variant_entry:
                    clauses.append((variant, variant_entry, options.synonym_weight))
                    slot_ids.update(p.doc for p in variant_entry.postings)
        term_slot_doc_sets.append(slot_ids)

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
    organic_candidate_ids = list(set.intersection(*all_doc_sets)) if all_doc_sets else []

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

    def _score_of(doc_id: int) -> float:
        return sum(
            score_term_for_doc(posting, entry.df, manifest, language, field_boosts)
            * term_boosts.get(term, 1.0)
            * weight
            for term, entry, weight in clauses
            for posting in entry.postings
            if posting.doc == doc_id
        )

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
        return Hit(
            id=doc_id,
            score=score,
            url=doc.url if doc else "",
            fields=doc.fields if doc else {},
            pinned=pinned,
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

    return SearchResult(hits=hits, total_hits=total_hits, language=language, facets=facets)
