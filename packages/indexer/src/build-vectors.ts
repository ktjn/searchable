import {
  chunkText,
  DEFAULT_CHUNK_OVERLAP_TOKENS,
  DEFAULT_CHUNK_TOKENS,
} from "./chunk-text.js";
import { extractDocument } from "./extract.js";
import type {
  EmbeddingProviderConfig,
  SourceDocument,
  VectorEntry,
  VectorShard,
} from "./types.js";

/**
 * Vector/hybrid search mechanics (docs/guides/vector-search.md),
 * deliberately scoped to storage/similarity mechanics only: this project
 * doesn't ship or run any embedding model itself -- `embed` is an
 * injectable seam a deployment supplies (a real ONNX/transformers.js
 * pipeline, a remote API call, or -- as this package's own tests do -- a
 * deterministic synthetic embedder), matching docs/guides/vector-search.md's own
 * "model-agnostic... which model to embed with is a deployment choice"
 * framing. Kept as a standalone async function rather than folded into
 * `buildIndex()` (which is deliberately synchronous, and whose 300+
 * existing tests shouldn't have to become async-aware) -- call this
 * separately and pass its result to `writeIndex(built, outDir, {
 * vectors })`.
 */
export interface VectorsBuildOptions {
  /**
   * Embeds a batch of passage texts, in order -- called once per
   * language with every chunk produced for that language's documents,
   * not once per chunk, so a real embedding backend can batch
   * efficiently. Must return exactly one vector per input text, and
   * every vector (across every language) must have the same length.
   */
  embed: (texts: string[]) => Promise<number[][]> | number[][];
  /** Recorded on the manifest as-is (@ktjn/searchable-format's EmbeddingProviderConfig doc comment) -- defaults to `{ type: "custom" }`, since `embed` is an arbitrary injectable function this package has no way to identify further. */
  provider?: EmbeddingProviderConfig;
  /** Defaults to `"int8"` (docs/guides/vector-search.md's recommended default: ~4x smaller, negligible recall loss). `"float32"` stores `embed()`'s raw output as-is. */
  quantization?: "float32" | "int8";
  /** Passed straight to `chunkText()` -- see its own doc comment. */
  chunkTokens?: number;
  chunkOverlapTokens?: number;
}

export interface BuiltVectors {
  /** Language -> its vector shard, only for languages with at least one chunk to embed. */
  shardsByLanguage: Record<string, VectorShard>;
  /** Corpus-wide embedding dimensionality (0 if no document produced any chunk at all). */
  dims: number;
  embeddingProvider: EmbeddingProviderConfig;
}

/**
 * Scalar-quantizes every dimension of every vector to a `[0, 255]`
 * integer against one shared min/max across the whole batch
 * (docs/guides/vector-search.md#storage-format's "per-shard
 * min/max scaling", not per-dimension). A zero-width range (every value
 * identical -- degenerate, but real for a trivial test embedder) maps
 * every value to `0` rather than dividing by zero; dequantizing then
 * correctly yields that one value back (`min + (0/255)*0 === min`).
 */
function quantizeInt8(vectors: number[][]): {
  quantized: number[][];
  quantRange: { min: number; max: number };
} {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const vector of vectors) {
    for (const value of vector) {
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { quantized: vectors, quantRange: { min: 0, max: 0 } };
  }
  const range = max - min;
  const quantized = vectors.map((vector) =>
    vector.map((value) =>
      range === 0 ? 0 : Math.round(((value - min) / range) * 255),
    ),
  );
  return { quantized, quantRange: { min, max } };
}

interface PendingChunk {
  passageId: string;
  docId: number;
  text: string;
}

/**
 * Re-extracts each source document (same extractDocument() call
 * buildIndex() itself makes) to chunk its title+body text and embed it
 * -- a small, deliberate duplication of that one extraction step rather
 * than threading full document text through `BuiltIndex` (whose doc
 * store only keeps a short excerpt, not the full body, since nothing
 * else needs it) just for this optional feature. `noindex` documents are
 * skipped, matching buildIndex()'s own skip, so a vector entry never
 * references a docId that isn't in the doc store.
 */
export async function buildVectorShards(
  sources: SourceDocument[],
  defaultLanguage: string,
  options: VectorsBuildOptions,
): Promise<BuiltVectors> {
  const quantization = options.quantization ?? "int8";
  const provider = options.provider ?? { type: "custom" };
  const chunkTokens = options.chunkTokens ?? DEFAULT_CHUNK_TOKENS;
  const chunkOverlapTokens =
    options.chunkOverlapTokens ?? DEFAULT_CHUNK_OVERLAP_TOKENS;
  if (!Number.isInteger(chunkTokens) || chunkTokens < 1) {
    throw new Error(
      `buildVectorShards: invalid chunkTokens ${JSON.stringify(chunkTokens)} — must be a positive integer`,
    );
  }
  if (
    !Number.isInteger(chunkOverlapTokens) ||
    chunkOverlapTokens < 0 ||
    chunkOverlapTokens >= chunkTokens
  ) {
    throw new Error(
      `buildVectorShards: invalid chunkOverlapTokens ${JSON.stringify(chunkOverlapTokens)} — must be a non-negative integer smaller than chunkTokens (${chunkTokens})`,
    );
  }

  const pendingByLanguage = new Map<string, PendingChunk[]>();
  for (const source of sources) {
    const extracted = extractDocument(source.html, source.url, defaultLanguage);
    if (extracted.noindex) continue;
    const fullText = [extracted.title, extracted.body]
      .filter(Boolean)
      .join("\n\n");
    const chunks = chunkText(fullText, chunkTokens, chunkOverlapTokens);
    if (chunks.length === 0) continue;
    let pending = pendingByLanguage.get(extracted.language);
    if (!pending) {
      pending = [];
      pendingByLanguage.set(extracted.language, pending);
    }
    for (const chunk of chunks) {
      pending.push({
        passageId: `${source.id}-${chunk.index}`,
        docId: source.id,
        text: chunk.text,
      });
    }
  }

  const shardsByLanguage: Record<string, VectorShard> = {};
  let dims: number | undefined;

  for (const [language, pending] of pendingByLanguage) {
    const rawVectors = await options.embed(pending.map((p) => p.text));
    if (rawVectors.length !== pending.length) {
      throw new Error(
        `buildVectorShards: embed() returned ${rawVectors.length} vectors for ${pending.length} input texts (language "${language}") — must return exactly one vector per input text, in order`,
      );
    }
    for (const vector of rawVectors) {
      if (dims === undefined) {
        dims = vector.length;
      } else if (vector.length !== dims) {
        throw new Error(
          `buildVectorShards: embed() returned a ${vector.length}-dimensional vector, expected ${dims} — every vector across the whole corpus must have the same length`,
        );
      }
    }

    let entries: VectorEntry[];
    let quantRange: { min: number; max: number } | undefined;
    if (quantization === "int8") {
      const { quantized, quantRange: range } = quantizeInt8(rawVectors);
      quantRange = range;
      entries = pending.map((p, i) => ({
        passageId: p.passageId,
        docId: p.docId,
        vector: quantized[i] as number[],
      }));
    } else {
      entries = pending.map((p, i) => ({
        passageId: p.passageId,
        docId: p.docId,
        vector: rawVectors[i] as number[],
      }));
    }

    shardsByLanguage[language] = {
      dims: dims ?? 0,
      quantization,
      ...(quantRange ? { quantRange } : {}),
      entries,
    };
  }

  return { shardsByLanguage, dims: dims ?? 0, embeddingProvider: provider };
}
