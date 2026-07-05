import type {
  DocStoreShard,
  FacetShard,
  FieldPosting,
  Manifest,
  PinsShard,
  Posting,
  TermEntry,
  TermShard,
} from "@csf/format";

export type {
  DocStoreEntry,
  DocStoreShard,
  FacetShard,
  FacetValueEntry,
  FieldPosting,
  FieldConfig,
  Manifest,
  PinDoc,
  PinEntry,
  PinsShard,
  Posting,
  TermEntry,
  TermShard,
} from "@csf/format";

export interface SourceDocument {
  id: number;
  url: string;
  html: string;
}

export interface BuiltIndex {
  manifest: Manifest;
  termShard: TermShard;
  docStore: DocStoreShard;
  /** Facet field name -> its shard, only for fields with at least one value. */
  facetShards: Record<string, FacetShard>;
  pinsShard: PinsShard;
  language: string;
  idRange: [number, number];
}
