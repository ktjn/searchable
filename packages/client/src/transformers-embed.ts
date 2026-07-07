/**
 * Real, local (no query-time backend) query embedding for
 * `SearchClientOptions.embedQuery` (docs/13-vector-and-hybrid-search.md),
 * backed by `@huggingface/transformers` (ONNX Runtime Web under the
 * hood) -- the query-time half of the same model
 * `packages/indexer/src/transformers-embed.ts` runs offline at build
 * time. Must be the *same* `model` the index's vector shards were built
 * with (`Manifest.vectors.embeddingProvider.model`) -- comparing a
 * query embedded by a different model against the corpus's vectors
 * produces meaningless cosine similarities, not an error. Returns its
 * `provider` alongside `embed` (not a bare function) specifically so
 * `SearchClient` can compare it against the manifest's own
 * `vectors.embeddingProvider` and fail fast on a mismatch instead
 * (`SearchClientOptions.validateVectorProvider`, on by default).
 *
 * Deliberately NOT a dependency of this package's core bundle
 * (docs/13's "pay only for what you use" — `@huggingface/transformers`
 * is tens of MB, wildly over this package's own ~15KB core budget):
 * `@huggingface/transformers` is only a `devDependency` here (so this
 * file's own typecheck/build has its types available) and an *optional*
 * `peerDependency` for consumers — the actual model-loading code below
 * is a lazy `import()`, only ever evaluated the first time the returned
 * `embed` function is called, and only resolves successfully if the
 * consuming application has installed `@huggingface/transformers` itself.
 */

import type { EmbeddingProviderConfig } from "@csf/format";

/** `Xenova/all-MiniLM-L6-v2`: matches `packages/indexer/src/transformers-embed.ts`'s own default -- keep both ends on the same default unless a deployment explicitly overrides both. */
export const DEFAULT_TRANSFORMERS_MODEL = "Xenova/all-MiniLM-L6-v2";

export type TransformersDtype =
  | "fp32"
  | "fp16"
  | "q8"
  | "int8"
  | "uint8"
  | "q4"
  | "bnb4"
  | "q4f16";

export interface TransformersEmbedQueryOptions {
  /** Must match whatever model built the index's vector shards. Defaults to `DEFAULT_TRANSFORMERS_MODEL`. */
  model?: string;
  /** Weight quantization to load. Defaults to `"q8"` (int8) -- only affects model-loading precision, unrelated to (and doesn't need to match) the index's own vector quantization. */
  dtype?: TransformersDtype;
}

async function loadTransformersExtractor(
  model: string,
  dtype: TransformersDtype,
) {
  const { pipeline } = await import("@huggingface/transformers");
  return pipeline("feature-extraction", model, { dtype });
}

export interface TransformersEmbedQuery {
  /** Ready to pass directly as `SearchClientOptions.embedQuery`. */
  embed: (query: string) => Promise<number[]>;
  /** Ready to compare against `Manifest.vectors.embeddingProvider` -- `SearchClient` does this itself when this whole object is passed as `embedQuery`. */
  provider: EmbeddingProviderConfig;
}

/**
 * Returns a ready-to-use `embedQuery` (`{embed, provider}`)
 * (`new SearchClient({ indexUrl, embedQuery: createTransformersEmbedQuery() })`).
 * The model itself loads lazily on the *first* call to `embed` (not when
 * this function is called) and is cached for every call after that -- a
 * consumer can safely call `createTransformersEmbedQuery()` up front
 * without paying any load cost until a caller actually requests
 * `mode: "vector"`/`"hybrid"`.
 */
export function createTransformersEmbedQuery(
  options: TransformersEmbedQueryOptions = {},
): TransformersEmbedQuery {
  const model = options.model ?? DEFAULT_TRANSFORMERS_MODEL;
  const dtype = options.dtype ?? "q8";
  let extractorPromise:
    | ReturnType<typeof loadTransformersExtractor>
    | undefined;

  const embed = async (query: string): Promise<number[]> => {
    if (!extractorPromise) {
      extractorPromise = loadTransformersExtractor(model, dtype);
    }
    const extractor = await extractorPromise;
    // A single-element batch, mirroring the indexer's own batched
    // slicing exactly (`packages/indexer/src/transformers-embed.ts`)
    // rather than relying on however this library shapes a bare
    // (non-array) single-string call's output.
    const output = await extractor([query], {
      pooling: "mean",
      normalize: true,
    });
    const dims = output.dims[output.dims.length - 1] as number;
    return Array.from((output.data as Float32Array).subarray(0, dims));
  };

  return { embed, provider: { type: "local-model", model } };
}
