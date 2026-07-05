import type {
  DocStoreShard,
  FieldPosting,
  Manifest,
  Posting,
  TermEntry,
  TermShard,
} from "@csf/format";

export type {
  DocStoreEntry,
  DocStoreShard,
  FieldPosting,
  FieldConfig,
  Manifest,
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
  language: string;
  idRange: [number, number];
}
