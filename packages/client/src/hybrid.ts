import { ownProp } from "@ktjn/searchable-analysis";
import type {
  DocStoreEntry,
  Manifest,
  VectorShard,
} from "@ktjn/searchable-format";
import { docStoreEntryToHit, fetchDocStoreEntriesByIds } from "./doc-store.js";
import type { ShardCache } from "./fetch-json.js";
import type { Hit, SearchOptions, SearchResult } from "./search.js";
import { resolve } from "./url.js";
import type { VectorHit } from "./vector-search.js";
import {
  bruteForceVectorSearch,
  reciprocalRankFusion,
} from "./vector-search.js";

/**
 * Runs brute-force cosine similarity (`./vector-search.js`) against the
 * manifest's vector shard for `language`, if one was built
 * (docs/guides/vector-search.md#storage-format) -- a language
 * with no vector shard (e.g. an empty partition, or a corpus built
 * without a `vectors` option at all) simply has no vector matches,
 * mirroring how a language with no term shard returns no lexical
 * matches, rather than being an error.
 */
export async function vectorHitsForLanguage(
  manifest: Manifest,
  cache: ShardCache,
  baseUrl: string,
  language: string,
  queryVector: number[],
  limit: number,
): Promise<VectorHit[]> {
  const file = manifest.vectors && ownProp(manifest.vectors.shards, language);
  if (!file) return [];
  const shard = await cache.fetchJson<VectorShard>(resolve(baseUrl, file));
  return bruteForceVectorSearch(queryVector, shard, limit);
}

/** How many candidates each side of a hybrid fusion considers, beyond the caller's own requested `limit` -- RRF/weighted fusion over just the final page size would starve out documents that rank, say, 4th on one side and 4th on the other from ever combining into a top-10 fused result. */
export function fusionCandidateLimit(limit: number): number {
  return Math.max(limit * 3, 30);
}

export async function vectorOnlySearch(
  manifest: Manifest,
  cache: ShardCache,
  baseUrl: string,
  queryVector: number[],
  options: SearchOptions,
): Promise<SearchResult> {
  const language = options.language ?? manifest.defaultLanguage;
  const limit = options.limit ?? 10;
  const vectorHits = await vectorHitsForLanguage(
    manifest,
    cache,
    baseUrl,
    language,
    queryVector,
    limit,
  );
  const docLookup = await fetchDocStoreEntriesByIds(
    manifest,
    cache,
    baseUrl,
    vectorHits.map((v) => v.docId),
  );
  const hits = vectorHits.map((v) =>
    docStoreEntryToHit(v.docId, v.score, docLookup.get(v.docId)),
  );
  return { hits, totalHits: hits.length, language };
}

/** `(v - min) / (max - min)` over `values`, clamped to a constant `1` when every value is identical (nothing to distinguish, and avoids a divide-by-zero) -- used to bring BM25F scores and cosine similarities onto a comparable `[0, 1]` scale before a weighted combination, since only RRF's rank-based default is calibration-free. */
function minMaxNormalize(values: number[]): (value: number) => number {
  if (values.length === 0) return () => 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return () => 1;
  return (value: number) => (value - min) / (max - min);
}

/**
 * Combines a lexical result (computed with a wider-than-requested limit
 * so fusion has real candidates to work with, per `fusionCandidateLimit`)
 * with an independent vector search over the same query
 * (docs/guides/vector-search.md#hybrid-search-combining-lexical-and-vector-scores).
 * Pinned hits (docs/guides/pinning.md) are carried over
 * unchanged and excluded from fusion entirely -- a pin is an editorial
 * override, not a candidate for a similarity-based reordering -- so only
 * the *organic* lexical hits are fused with the vector hits, then both
 * are re-merged with the untouched pinned hits in front, truncated to
 * the caller's real `options.limit`.
 */
export async function fuseHybridResult(
  manifest: Manifest,
  cache: ShardCache,
  baseUrl: string,
  lexicalResult: SearchResult,
  vectorHits: VectorHit[],
  options: SearchOptions,
): Promise<SearchResult> {
  const limit = options.limit ?? 10;
  const pinnedHits = lexicalResult.hits.filter((h) => h.pinned);
  const organicLexicalHits = lexicalResult.hits.filter((h) => !h.pinned);
  const pinnedIds = new Set(pinnedHits.map((h) => h.id));

  const nonPinnedVectorHits = vectorHits.filter((v) => !pinnedIds.has(v.docId));

  let combined: Map<number, number>;
  if (options.vectorWeight !== undefined) {
    const vectorWeight = options.vectorWeight;
    const normalizeLexical = minMaxNormalize(
      organicLexicalHits.map((h) => h.score),
    );
    const normalizeVector = minMaxNormalize(
      nonPinnedVectorHits.map((v) => v.score),
    );
    combined = new Map<number, number>();
    for (const hit of organicLexicalHits) {
      combined.set(
        hit.id,
        (combined.get(hit.id) ?? 0) +
          (1 - vectorWeight) * normalizeLexical(hit.score),
      );
    }
    for (const v of nonPinnedVectorHits) {
      combined.set(
        v.docId,
        (combined.get(v.docId) ?? 0) + vectorWeight * normalizeVector(v.score),
      );
    }
  } else {
    combined = reciprocalRankFusion([
      organicLexicalHits.map((h) => h.id),
      nonPinnedVectorHits.map((v) => v.docId),
    ]);
  }

  const ranked = [...combined.entries()].sort((a, b) => b[1] - a[1]);
  const remainingSlots = Math.max(0, limit - pinnedHits.length);
  const topRanked = ranked.slice(0, remainingSlots);

  const lexicalHitById = new Map(organicLexicalHits.map((h) => [h.id, h]));
  const missingIds = topRanked
    .map(([id]) => id)
    .filter((id) => !lexicalHitById.has(id));
  const extraDocLookup = missingIds.length
    ? await fetchDocStoreEntriesByIds(manifest, cache, baseUrl, missingIds)
    : new Map<number, DocStoreEntry>();

  const hits: Hit[] = [
    ...pinnedHits,
    ...topRanked.map(([id, fusedScore]) => {
      const existing = lexicalHitById.get(id);
      return existing
        ? { ...existing, score: fusedScore }
        : docStoreEntryToHit(id, fusedScore, extraDocLookup.get(id));
    }),
  ];

  const totalHits = new Set([...pinnedIds, ...combined.keys()]).size;

  return {
    hits,
    ...(lexicalResult.facets ? { facets: lexicalResult.facets } : {}),
    totalHits,
    language: lexicalResult.language,
    ...(lexicalResult.didYouMean
      ? { didYouMean: lexicalResult.didYouMean }
      : {}),
  };
}
