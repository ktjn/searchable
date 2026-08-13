export { isRtlLanguage } from "./analysis/index.js";
export type {
  SearchClientEventMap,
  SearchClientOptions,
  SearchStreamOptions,
} from "./client.js";
export { SearchClient } from "./client.js";
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
export type { ValidateManifestOptions } from "./validate-manifest.js";
export { InvalidManifestError, validateManifest } from "./validate-manifest.js";
