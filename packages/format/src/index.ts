/**
 * Manifest and shard shapes, mirroring spec/schema/*.schema.json and
 * docs/02-index-format.md. This package has no runtime logic — it
 * exists so the indexer (which writes this shape) and the client
 * (which reads it) share one type definition instead of two that could
 * silently drift apart.
 */

export interface FieldConfig {
  boost: number;
  stored: boolean;
}

export interface Manifest {
  version: 1;
  buildId: string;
  format: "json" | "binary";
  languages: string[];
  defaultLanguage: string;
  fields: Record<string, FieldConfig>;
  docCount: number;
  avgFieldLength: Record<string, number>;
  shards: {
    terms: Array<{
      lang: string;
      prefix: string;
      file: string;
      termCount: number;
    }>;
    docs: Array<{ shard: number; file: string; idRange: [number, number] }>;
  };
}

export interface FieldPosting {
  tf: number;
  pos: number[];
  /** Total token count of this field for this doc (BM25F length norm). */
  len: number;
}

export interface Posting {
  doc: number;
  fields: Record<string, FieldPosting>;
}

export interface TermEntry {
  df: number;
  postings: Posting[];
}

export type TermShard = Record<string, TermEntry>;

export interface DocStoreEntry {
  url: string;
  fields: Record<string, string>;
}

export type DocStoreShard = Record<string, DocStoreEntry>;
