import type {
  DocStoreShard,
  FacetShard,
  FuzzyShard,
  Manifest,
  PinsShard,
  SynonymShard,
  TermShard,
} from "@ktjn/searchable-format";

export type {
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
  SynonymShard,
  TermEntry,
  TermShard,
  VectorEntry,
  VectorShard,
} from "@ktjn/searchable-format";

export interface SourceDocument {
  id: number;
  url: string;
  html: string;
}

export interface BuiltIndex {
  manifest: Manifest;
  /** Language -> its term shard (docs/guides/internationalization.md#mixed-language-corpora-and-queries). */
  termShards: Record<string, TermShard>;
  docStore: DocStoreShard;
  /** Facet field name -> its shard, only for fields with at least one value. Corpus-wide, not partitioned by language. */
  facetShards: Record<string, FacetShard>;
  /** Language -> its pins shard, only for languages with at least one searchable-pin. */
  pinsShards: Record<string, PinsShard>;
  /** Language -> its synonym shard, only for languages with an authored synonym set (BuildIndexOptions.synonyms). */
  synonymShards: Record<string, SynonymShard>;
  /** Language -> its fuzzy (SymSpell deletion dictionary) shard, only built when BuildIndexOptions.fuzzy is true. */
  fuzzyShards: Record<string, FuzzyShard>;
  idRange: [number, number];
}
