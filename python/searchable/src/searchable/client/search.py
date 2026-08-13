from collections.abc import Iterable, Iterator
from dataclasses import replace

from searchable.analysis import get_language_profile, normalize_phrase
from searchable.client.doc_store import _fetch_doc_store_entries_by_ids
from searchable.client.facets import (
    _fetch_facet_shards,
    _union_docs_for_field,
    _values_for,
)
from searchable.client.fetch import ShardCache, resolve_url
from searchable.client.fuzzy import (
    _fuzzy_matches_for,
    _load_fuzzy_lookup,
    _nearest_terms_for,
)
from searchable.client.highlight import HighlightTerm, highlight_text
from searchable.client.parse_query import parse_query
from searchable.client.phrase import _contains_phrase, _has_consecutive_positions
from searchable.client.score import score_term_for_doc
from searchable.client.synonyms import _multi_word_variants_for, _synonym_variants_for
from searchable.client.types import (
    FacetResult,
    FacetResultValue,
    FacetValuesOptions,
    Hit,
    Manifest,
    SearchOptions,
    SearchResult,
    TermEntry,
    TermShardEntry,
    pins_shard_from_dict,
    synonym_shard_from_dict,
    term_shard_from_dict,
)

UNSHARDED_TERM_SHARD_PREFIX = "all"
MAX_SUGGESTIONS_PER_TERM = 3


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

    if options.operator not in ("and", "or"):
        raise ValueError(f"unsupported operator {options.operator!r}")

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
        phrase_words = [qt.term for qt in phrase_term.terms]
        exact_terms_needed.update(phrase_words)
        if options.synonyms and synonym_shard:
            for variant in _multi_word_variants_for(" ".join(phrase_words), synonym_shard):
                exact_terms_needed.update(variant.split(" "))

    needed_shard_entries = _shard_entries_for_query(
        shard_entries, exact_terms_needed, prefixes_needed
    )
    term_lookup: dict[str, TermEntry] = {}
    for entry in needed_shard_entries:
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
        # Each quoted phrase is tried literally first, then via every other
        # phrase in its multiWord synonym group (docs/guides/synonyms.md), each
        # variant weighted at `synonym_weight` like a single-word synonym --
        # mirroring the TS client's `multiWordVariantsFor` attempt loop. The
        # clause only supports a variant if that *variant* adjacency-matched;
        # a doc matching a lower-weight variant isn't scored as if the literal
        # phrase matched there.
        attempts: list[tuple[list[str], float]] = [(phrase_words, 1.0)]
        if options.synonyms and synonym_shard:
            for variant in _multi_word_variants_for(" ".join(phrase_words), synonym_shard):
                attempts.append((variant.split(" "), options.synonym_weight))

        total_matched_ids: set[int] = set()
        for attempt_words, attempt_weight in attempts:
            attempt_entries = [term_lookup.get(w) for w in attempt_words]
            if any(e is None for e in attempt_entries):
                if attempt_weight == 1.0:
                    for w in attempt_words:
                        if term_lookup.get(w) is None and w not in failed_terms:
                            failed_terms.append(w)
                continue
            attempt_word_doc_sets = [
                set(p.doc for p in e.postings) for e in attempt_entries if e is not None
            ]
            attempt_common_ids = (
                set.intersection(*attempt_word_doc_sets) if attempt_word_doc_sets else set()
            )
            attempt_matched_ids = {
                doc_id
                for doc_id in attempt_common_ids
                if _has_consecutive_positions(attempt_entries, doc_id)
            }
            total_matched_ids.update(attempt_matched_ids)
            for phrase_word, phrase_entry in zip(attempt_words, attempt_entries, strict=True):
                if phrase_entry is None:
                    continue
                # Note: if a phrase word also appears as a bare query term, both the plain-term
                # clause and this phrase clause contribute to its score -- intentional/acceptable.
                restricted = TermEntry(
                    df=phrase_entry.df,
                    postings=[p for p in phrase_entry.postings if p.doc in attempt_matched_ids],
                )
                clauses.append((phrase_word, restricted, attempt_weight))
        phrase_doc_sets.append(total_matched_ids)

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


__all__ = [
    "FacetResult",
    "FacetResultValue",
    "FacetValuesOptions",
    "Hit",
    "SearchOptions",
    "SearchResult",
    "facet_values",
    "retrieve",
    "search",
    "search_stream",
]
