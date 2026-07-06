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
  /** Names of fields with at least one facet value in the corpus. */
  facetFields?: string[];
  /**
   * Doc count and average field length, keyed by language. BM25's idf
   * (docs/04-query-ranking-boosts.md#ranking-model-bm25f) and length
   * normalization must be computed within the language partition
   * actually being searched — a query against the "de" term shard only
   * ever sees "de" postings, so mixing in English corpus-wide stats
   * would skew both. Sum the values for a whole-corpus total.
   */
  docCount: Record<string, number>;
  avgFieldLength: Record<string, Record<string, number>>;
  shards: {
    terms: Array<{
      lang: string;
      prefix: string;
      file: string;
      termCount: number;
    }>;
    facets?: Array<{ field: string; file: string }>;
    docs: Array<{ shard: number; file: string; idRange: [number, number] }>;
  };
  /** lang -> pins shard file, only present for languages with at least one csf-pin. */
  pins?: Record<string, string>;
  /** lang -> synonyms shard file, only present for languages with an authored synonym set. */
  synonyms?: Record<string, string>;
  /** lang -> fuzzy shard file, only present for languages with a built deletion dictionary. */
  fuzzy?: Record<string, string>;
}

export interface FieldPosting {
  tf: number;
  pos: number[];
  /** Total token count of this field for this doc (BM25F length norm). */
  len: number;
}

export interface Posting {
  doc: number;
  /**
   * Document-level static boost (docs/04-query-ranking-boosts.md), e.g.
   * from a csf-boost meta tag. Denormalized onto every posting for this
   * doc — like `len` above — because it must be known for every
   * candidate being scored, not just the final top-N whose doc-store
   * data gets fetched. Absent/undefined means 1.0 (no boost).
   */
  boost?: number;
  fields: Record<string, FieldPosting>;
}

export interface TermEntry {
  df: number;
  postings: Posting[];
}

export type TermShard = Record<string, TermEntry>;

export interface DocStoreEntry {
  url: string;
  /** Mirrors the posting-level boost, for display/audit purposes only — scoring reads it from postings, not here. */
  boost?: number;
  fields: Record<string, string>;
}

export type DocStoreShard = Record<string, DocStoreEntry>;

export interface FacetValueEntry {
  /** Global count over the whole corpus, computed once at build time (docs/06-faceted-search.md#facet-counts). */
  count: number;
  docs: number[];
}

export interface RangeFacetValue {
  value: number;
  doc: number;
}

export interface FacetShard {
  type: "terms" | "range" | "hierarchy";
  separator?: string;
  /** Precomputed values for "terms"/"hierarchy" (per-value doc set + count); for "range", 5 equal-width buckets spanning the corpus's observed [min, max], keyed by a label like "10-20" or "80+" for the open-ended last bucket (docs/06-faceted-search.md#facet-index-structure). */
  values: Record<string, FacetValueEntry>;
  /** Only present for type: "range" -- every (value, doc) pair sorted ascending by value, so an arbitrary min/max filter can be resolved directly. */
  sorted?: RangeFacetValue[];
}

export interface PinDoc {
  id: number;
  priority: number;
  exclusive: boolean;
}

export interface PinEntry {
  mode: "exact" | "contains";
  docs: PinDoc[];
}

export type PinsShard = Record<string, PinEntry>;

/**
 * Single-word synonym data only (docs/05-synonyms.md) — `multiWord`
 * phrase-level synonyms are part of the design (and the JSON Schema)
 * but need a different, pre-tokenization matching path than the
 * single-term equivalence/directional lookups implemented so far, so
 * they're intentionally not produced or consumed yet.
 */
export interface SynonymShard {
  /** Symmetric equivalence classes: any term in a group expands the query to every other member. */
  equivalences?: string[][];
  /** Asymmetric: querying the key also matches the listed terms, but not vice versa. */
  directional?: Record<string, string[]>;
}

/**
 * A SymSpell-style precomputed deletion dictionary for typo-tolerant
 * matching (docs/04-query-ranking-boosts.md#prefix--fuzzy-matching).
 * Only `maxEdits: 1` is produced by the reference indexer today —
 * `deletions` maps a deletion-variant string (a real term with 0 or 1
 * characters removed) to every real term that produced it, so a query
 * term's own deletion variants can be looked up directly instead of
 * scanning the whole vocabulary; the client still verifies true edit
 * distance against candidates before treating them as a fuzzy match
 * (this dictionary is a fast candidate generator, not a distance oracle
 * — two terms can collide on the same deletion variant while actually
 * being more than `maxEdits` apart).
 */
export interface FuzzyShard {
  maxEdits: 1 | 2;
  deletions: Record<string, string[]>;
}
