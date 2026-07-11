export type { BuildIndexOptions } from "./build-index.js";
export { buildIndex } from "./build-index.js";
export type { BuiltVectors, VectorsBuildOptions } from "./build-vectors.js";
export { buildVectorShards } from "./build-vectors.js";
export type { Chunk } from "./chunk-text.js";
export { chunkText } from "./chunk-text.js";
export { discoverHtmlDocuments } from "./discover.js";
export type {
  CanonicalUrlOptions,
  ExtractedDocument,
  PinDeclaration,
} from "./extract.js";
export { extractDocument } from "./extract.js";
export type {
  TransformersDtype,
  TransformersEmbedder,
  TransformersEmbedderOptions,
} from "./transformers-embed.js";
export {
  createTransformersEmbedder,
  DEFAULT_TRANSFORMERS_MODEL,
} from "./transformers-embed.js";
export type {
  BuiltIndex,
  DocStoreEntry,
  DocStoreShard,
  EmbeddingProviderConfig,
  FacetShard,
  FacetValueEntry,
  FieldConfig,
  FieldPosting,
  FuzzyShard,
  Manifest,
  PinDoc,
  PinEntry,
  PinsShard,
  Posting,
  RangeFacetValue,
  SourceDocument,
  SynonymShard,
  TermEntry,
  TermShard,
  VectorEntry,
  VectorShard,
} from "./types.js";
export type { WriteIndexOptions } from "./write-index.js";
export { writeIndex } from "./write-index.js";
