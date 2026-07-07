export { isRtlLanguage } from "@csf/analysis";
export { SearchClient } from "./client.js";
export type {
  SearchClientEventMap,
  SearchClientOptions,
  SearchStreamOptions,
} from "./client.js";
export { registerOfflineCaching } from "./offline.js";
export type { OfflineCacheOptions } from "./offline.js";
export {
  createTransformersEmbedQuery,
  DEFAULT_TRANSFORMERS_MODEL,
} from "./transformers-embed.js";
export type {
  TransformersDtype,
  TransformersEmbedQueryOptions,
} from "./transformers-embed.js";
export type { HighlightSpan, HighlightTerm } from "./highlight.js";
export type {
  FacetResult,
  FacetResultValue,
  FacetValuesOptions,
  Hit,
  RangeFilter,
  SearchOptions,
  SearchResult,
} from "./search.js";
export { InvalidManifestError, validateManifest } from "./validate-manifest.js";
export type { ValidateManifestOptions } from "./validate-manifest.js";
export {
  cosineSimilarity,
  DEFAULT_RRF_K,
  dequantizeVector,
  reciprocalRankFusion,
  VectorSearchNotConfiguredError,
} from "./vector-search.js";
export type { VectorHit } from "./vector-search.js";
