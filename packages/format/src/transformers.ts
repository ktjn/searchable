/**
 * Transformers embedding constants shared by the indexer (build-time) and
 * the client (query-time) so both ends default to the same model and dtype
 * vocabulary without a "keep both files in sync" comment. Both packages
 * deliberately keep their *own* model-loading code separate (the indexer
 * loads eagerly, the client lazily) — only the shared defaults and the
 * dtype union live here.
 */

/** `Xenova/all-MiniLM-L6-v2`: a widely-used, small (~90MB fp32, ~23MB int8-quantized), 384-dim sentence-embedding model -- a reasonable, well-known default, not a claim that it's the best choice for every deployment. */
export const DEFAULT_TRANSFORMERS_MODEL = "Xenova/all-MiniLM-L6-v2";

/**
 * ONNX Runtime's supported weight precisions, matching
 * `@huggingface/transformers`'s own `PretrainedOptions.dtype` (which the
 * `dtype` option is passed straight through to) -- re-declared here rather
 * than imported so neither package's own public type leaks an exact-version
 * dependency on that library's internal type name.
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
