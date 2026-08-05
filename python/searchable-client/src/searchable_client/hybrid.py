"""Vector-only and hybrid (lexical+vector fusion) search paths (mirrors
packages/client/src/hybrid.ts).
"""

from dataclasses import replace
from math import isfinite

from searchable_client.doc_store import _fetch_doc_store_entries_by_ids
from searchable_client.errors import (
    InvalidVectorShardError,
    VectorSearchNotConfiguredError,
)
from searchable_client.fetch import ShardCache, resolve_url
from searchable_client.types import (
    Hit,
    Manifest,
    SearchOptions,
    SearchResult,
    vector_shard_from_dict,
)
from searchable_client.vectors import (
    VectorHit,
    brute_force_vector_search,
    reciprocal_rank_fusion,
)


def _load_vector_hits(
    manifest: Manifest,
    cache: ShardCache,
    base_url: str,
    language: str,
    query_vector: list[float],
    limit: int,
) -> list["VectorHit"]:
    # A language without a vector shard (empty partition, or a corpus built
    # without a `vectors` option) simply has no vector matches, mirroring how a
    # language with no term shard returns no lexical matches rather than raising
    # -- same as the TS client (`vectorHitsForLanguage`). Callers that want a
    # loud error (SearchClient.search) check `manifest.vectors` separately.
    vectors = manifest.vectors
    if vectors is None or language not in vectors.shards:
        return []
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
    from searchable_client.search import search

    if query_vector is None:
        raise VectorSearchNotConfiguredError(
            f'Search mode "{options.mode}" requires a query vector'
        )
    limit = max(0, options.limit)
    # RRF/weighted fusion over just the final page size would starve out
    # documents that rank, say, 4th on one side and 4th on the other from ever
    # combining into a top-10 fused result -- same floor as the TS client
    # (fusionCandidateLimit).
    candidate_limit = max(limit * 3, 30)
    vector_hits = _load_vector_hits(
        manifest, cache, base_url, language, query_vector, candidate_limit
    )
    if options.mode == "vector":
        return _vector_hit_result(vector_hits[:limit], manifest, cache, base_url, options, language)

    lexical_options = replace(options, mode="lexical", vector_weight=None, limit=candidate_limit)
    lexical_result = search(query, manifest, cache, base_url, lexical_options)

    # Pinned hits are an editorial override, not candidates for a
    # similarity-based reordering: carry them through unchanged, exclude them
    # (and their vector hits) from fusion entirely, then re-merge in front,
    # truncating to the caller's real limit after -- mirrors the TS client's
    # fuseHybridResult.
    pinned_hits = [hit for hit in lexical_result.hits if hit.pinned]
    organic_lexical = [hit for hit in lexical_result.hits if not hit.pinned]
    pinned_ids = {hit.id for hit in pinned_hits}
    non_pinned_vector_hits = [v for v in vector_hits if v.doc_id not in pinned_ids]
    organic_lexical_by_id = {hit.id: hit for hit in organic_lexical}
    non_pinned_vector_by_id = {v.doc_id: v for v in non_pinned_vector_hits}

    if options.vector_weight is None:
        fused_scores = reciprocal_rank_fusion(
            [[hit.id for hit in organic_lexical], [v.doc_id for v in non_pinned_vector_hits]]
        )
    else:
        if not 0.0 <= options.vector_weight <= 1.0:
            raise ValueError("vector_weight must be between 0 and 1")
        lexical_normalized = _normalize_scores([hit.score for hit in organic_lexical])
        vector_normalized = _normalize_scores([v.score for v in non_pinned_vector_hits])
        fused_scores = {
            doc_id: (1.0 - options.vector_weight)
            * lexical_normalized.get(organic_lexical_by_id[doc_id].score, 0.0)
            + options.vector_weight
            * vector_normalized.get(non_pinned_vector_by_id[doc_id].score, 0.0)
            for doc_id in {*organic_lexical_by_id, *non_pinned_vector_by_id}
        }
    ranked = sorted(fused_scores, key=lambda doc_id: (-fused_scores[doc_id], doc_id))
    remaining_slots = max(0, limit - len(pinned_hits))
    top_ranked = ranked[:remaining_slots]
    missing_ids = [doc_id for doc_id in top_ranked if doc_id not in organic_lexical_by_id]
    doc_lookup = _fetch_doc_store_entries_by_ids(manifest, cache, base_url, missing_ids)
    hits: list[Hit] = list(pinned_hits)
    for doc_id in top_ranked:
        lexical_hit = organic_lexical_by_id.get(doc_id)
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
        total_hits=len({*pinned_ids, *fused_scores}),
        language=language,
        facets=lexical_result.facets,
        did_you_mean=lexical_result.did_you_mean,
    )
