/** docs/13-vector-and-hybrid-search.md#chunking's "~200 tokens with ~20-token overlap" example. */
export const DEFAULT_CHUNK_TOKENS = 200;
export const DEFAULT_CHUNK_OVERLAP_TOKENS = 20;

export interface Chunk {
  index: number;
  text: string;
}

/**
 * Splits `text` into overlapping passages for embedding
 * (docs/13-vector-and-hybrid-search.md#chunking) -- a whitespace word
 * split, not the stemmed/lowercased tokens `@csf/analysis` produces for
 * lexical indexing: an embedding model wants natural surface text, not
 * an already-destemmed bag of words. `chunkTokens`/`overlapTokens` count
 * whitespace-split words, a deliberately simple proxy for "model tokens"
 * that needs no tokenizer dependency -- good enough for bounding passage
 * size, not a claim of matching any specific model's real tokenization.
 * A document shorter than `chunkTokens` produces exactly one chunk (the
 * whole text); an empty/whitespace-only text produces no chunks at all,
 * since there's nothing meaningful to embed.
 */
export function chunkText(
  text: string,
  chunkTokens: number = DEFAULT_CHUNK_TOKENS,
  overlapTokens: number = DEFAULT_CHUNK_OVERLAP_TOKENS,
): Chunk[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const stride = Math.max(1, chunkTokens - overlapTokens);
  const chunks: Chunk[] = [];
  for (
    let start = 0, index = 0;
    start < words.length;
    start += stride, index++
  ) {
    chunks.push({
      index,
      text: words.slice(start, start + chunkTokens).join(" "),
    });
    if (start + chunkTokens >= words.length) break;
  }
  return chunks;
}
