import { pipeline } from "@huggingface/transformers";
import type { EmbeddingProviderConfig } from "./types.js";

/**
 * A real, local (no query-time backend) embedding source for
 * `buildVectorShards({ embed, provider })`
 * (docs/guides/vector-search.md), backed by
 * `@huggingface/transformers` -- a quantized sentence-embedding ONNX
 * model run via ONNX Runtime Web/Node, matching the design doc's
 * default-philosophy option 1 ("ship a small embedding model", not the
 * remote-API escape hatch). This is the offline (build-time) half only:
 * `packages/client/src/transformers-embed.ts` runs the *same* model
 * query-time, in the browser, lazily.
 *
 * Not exercised by this repo's default `pnpm test` run against the real
 * Hugging Face Hub: model weights are fetched from `huggingface.co` on
 * first use (and cached locally by the library afterward), which this
 * package has no control over and some CI/sandboxed environments
 * deliberately block outbound access to -- see
 * `packages/indexer/test/transformers-embed.test.ts` for what's
 * verified without network (the batching/shape logic, via a mocked
 * `pipeline`) versus the explicitly opt-in real-model test.
 */

/** `Xenova/all-MiniLM-L6-v2`: a widely-used, small (~90MB fp32, ~23MB int8-quantized), 384-dim sentence-embedding model -- a reasonable, well-known default, not a claim that it's the best choice for every deployment. */
export const DEFAULT_TRANSFORMERS_MODEL = "Xenova/all-MiniLM-L6-v2";

/**
 * ONNX Runtime's supported weight precisions, matching
 * `@huggingface/transformers`'s own `PretrainedOptions.dtype` (which
 * this option is passed straight through to) -- re-declared here rather
 * than imported so this package's own public type doesn't leak an
 * exact-version dependency on that library's internal type name.
 */
export type TransformersDtype =
  | "fp32"
  | "fp16"
  | "q8"
  | "int8"
  | "uint8"
  | "q4"
  | "bnb4"
  | "q4f16";

export interface TransformersEmbedderOptions {
  /** Any Hugging Face Hub sentence-embedding model id compatible with the `feature-extraction` pipeline. Defaults to `DEFAULT_TRANSFORMERS_MODEL`. */
  model?: string;
  /** Weight quantization to load. Defaults to `"q8"` (int8), matching this project's own size-consciousness default for its own vector quantization (docs/guides/vector-search.md#storage-format). */
  dtype?: TransformersDtype;
}

export interface TransformersEmbedder {
  /** Ready to pass directly as `VectorsBuildOptions.embed` (`./build-vectors.js`). */
  embed: (texts: string[]) => Promise<number[][]>;
  /** Ready to pass directly as `VectorsBuildOptions.provider`. */
  provider: EmbeddingProviderConfig;
}

/**
 * Loads `options.model` once (the expensive step -- downloads and
 * initializes the ONNX session) and returns a reusable batch-embedding
 * function plus the `embeddingProvider` metadata `buildVectorShards()`
 * records on the manifest. Mean-pools and L2-normalizes token
 * embeddings into one fixed-length vector per input text, the standard
 * sentence-embedding recipe for encoder models like MiniLM.
 */
export async function createTransformersEmbedder(
  options: TransformersEmbedderOptions = {},
): Promise<TransformersEmbedder> {
  const model = options.model ?? DEFAULT_TRANSFORMERS_MODEL;
  const dtype = options.dtype ?? "q8";
  const extractor = await pipeline("feature-extraction", model, { dtype });

  const embed = async (texts: string[]): Promise<number[][]> => {
    if (texts.length === 0) return [];
    const output = await extractor(texts, {
      pooling: "mean",
      normalize: true,
    });
    const dims = output.dims[output.dims.length - 1] as number;
    const data = output.data as Float32Array;
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      vectors.push(Array.from(data.subarray(i * dims, (i + 1) * dims)));
    }
    return vectors;
  };

  return { embed, provider: { type: "local-model", model } };
}
