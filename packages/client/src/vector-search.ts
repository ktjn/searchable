import type { VectorShard } from "@csf/format";

/**
 * Thrown by `mode: "vector"`/`"hybrid"` when no query embedding is
 * available — either `SearchClientOptions.embedQuery` wasn't configured,
 * or a direct (non-`SearchClient`) caller of `search()` didn't supply a
 * `queryVector` (docs/13-vector-and-hybrid-search.md#api-surface).
 * Deliberately loud rather than silently degrading to lexical-only —
 * a caller who explicitly asked for semantic search should know their
 * results aren't actually semantic.
 */
export class VectorSearchNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VectorSearchNotConfiguredError";
  }
}

/**
 * Thrown by `mode: "vector"`/`"hybrid"` when `embedQuery` declares its
 * own `provider` (docs/13-vector-and-hybrid-search.md#api-surface) and it
 * doesn't match the manifest's `vectors.embeddingProvider` -- comparing
 * a query embedded by one model against corpus vectors built by another
 * produces meaningless cosine similarities, not an error, unless this
 * check catches the mismatch first. Fails loud rather than silently
 * returning plausible-looking but wrong rankings; opt out via
 * `SearchClientOptions.validateVectorProvider: false` for a deployment
 * that's certain the mismatch is intentional (e.g. deliberately testing
 * cross-model behavior).
 */
export class VectorProviderMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VectorProviderMismatchError";
  }
}

/**
 * Vector/hybrid search mechanics (docs/13-vector-and-hybrid-search.md):
 * dequantization, brute-force cosine similarity, and Reciprocal Rank
 * Fusion. Deliberately the simplest thing that meets the bar per that
 * doc's own framing — no IVF clustering, no HNSW, no WASM-accelerated
 * scoring; those are explicit future opt-ins, not this slice.
 */

/** Reverses `VectorShard.quantRange` scalar quantization; a `"float32"` shard's values are stored as-is, so this is a no-op copy for that case. */
export function dequantizeVector(
  vector: number[],
  shard: VectorShard,
): number[] {
  if (shard.quantization !== "int8" || !shard.quantRange) return vector;
  const { min, max } = shard.quantRange;
  const range = max - min;
  return vector.map((raw) => min + (raw / 255) * range);
}

/** Standard cosine similarity, `dot(a, b) / (‖a‖ · ‖b‖)`. Either vector being all-zero makes similarity undefined, not infinite/NaN — treated as `0` (no similarity) rather than throwing. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] as number;
    const bv = b[i] as number;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface VectorHit {
  docId: number;
  passageId: string;
  score: number;
}

/**
 * Scores `queryVector` against every entry in `shard` (dequantizing
 * first as needed) via cosine similarity, then collapses to one hit per
 * document — keeping only that document's best-scoring passage, per
 * docs/13's "a document can surface in vector search results via any one
 * of its passages" — before sorting descending and truncating to
 * `limit`. `O(shard size)` per query, the documented brute-force
 * tradeoff, fine up to "the low hundreds of thousands of passages."
 */
export function bruteForceVectorSearch(
  queryVector: number[],
  shard: VectorShard,
  limit: number,
): VectorHit[] {
  const bestByDoc = new Map<number, VectorHit>();
  for (const entry of shard.entries) {
    const score = cosineSimilarity(
      queryVector,
      dequantizeVector(entry.vector, shard),
    );
    const existing = bestByDoc.get(entry.docId);
    if (!existing || score > existing.score) {
      bestByDoc.set(entry.docId, {
        docId: entry.docId,
        passageId: entry.passageId,
        score,
      });
    }
  }
  return [...bestByDoc.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Standard IR constant (docs/13-vector-and-hybrid-search.md#hybrid-search-combining-lexical-and-vector-scores). */
export const DEFAULT_RRF_K = 60;

/**
 * Combines any number of independently-ranked id lists (best first) into
 * one fused score per id: `Σ 1 / (k + rank)` across every list the id
 * appears in (1-based rank), zero contribution from lists it's absent
 * from — Reciprocal Rank Fusion, picked over score normalization because
 * it needs no calibration across incomparable score scales (BM25F vs.
 * cosine similarity).
 */
export function reciprocalRankFusion(
  rankedIdLists: number[][],
  k: number = DEFAULT_RRF_K,
): Map<number, number> {
  const fused = new Map<number, number>();
  for (const ids of rankedIdLists) {
    ids.forEach((id, index) => {
      fused.set(id, (fused.get(id) ?? 0) + 1 / (k + index + 1));
    });
  }
  return fused;
}
