/**
 * Manifest and shard shapes, mirroring spec/schema/*.schema.json and
 * docs/concepts/index-format.md. This package exists so the indexer
 * (which writes this shape) and the client (which reads it) share one
 * type definition instead of two that could silently drift apart. It
 * also owns the small, dependency-free runtime helpers (currently
 * `canonicalize`) that both sides must apply identically so their
 * canonical hashes can never diverge.
 */

export interface FieldConfig {
  boost?: number;
  stored: boolean;
  indexed?: boolean;
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
   * (docs/guides/ranking-and-boosts.md#ranking-model-bm25f) and length
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
      /**
       * Per-shard physical encoding (docs/archive/specs/binary-format.md#manifest-integration):
       * `"binary"` for the directory-based delta+varint encoding
       * (docs/concepts/binary-storage.md's validated design), absent or
       * `"json"` for the plain JSON shape every other shard type uses.
       * Declared per shard, not globally, so a deployment can mix both
       * during migration — a client must check this per entry, not
       * assume every term shard in a manifest shares one format.
       */
      format?: "json" | "binary";
    }>;
    facets?: Array<{ field: string; file: string }>;
      docs: Array<{
        shard: number;
        file: string;
        idRange: [number, number];
      /**
       * Per-shard physical encoding, same allowance and same meaning as
       * the term shard entry's `format` field above
       * (docs/archive/specs/binary-format.md#manifest-integration) — a
       * directory-based `docId -> (byte offset, byte length)` encoding
       * (`python/searchable-indexer/src/searchable_indexer/binary_doc_store.py`,
       * `packages/client/src/binary-doc-store.ts`) in place of the plain
         * JSON `Record<docId, DocStoreEntry>` shape, so a query only ever
       * decodes the specific hit ids it needs instead of the whole doc
       * store.
         */
        format?: "json" | "binary";
        /** Structured binary document-store wire version; absent for JSON and v1 shards. */
        binaryVersion?: number;
      }>;
  };
  /** lang -> pins shard file, only present for languages with at least one searchable-pin. */
  pins?: Record<string, string>;
  /** lang -> synonyms shard file, only present for languages with an authored synonym set. */
  synonyms?: Record<string, string>;
  /**
   * lang -> fuzzy shard, only present for languages with a built deletion
   * dictionary. An object (not a bare file-string like `pins`/`synonyms`
   * above) because `format` needs somewhere to live: a directory-based
   * `deletionVariant -> (byte offset, byte length)` encoding
   * (`python/searchable-indexer/src/searchable_indexer/binary_fuzzy_shard.py`,
   * `packages/client/src/binary-fuzzy-shard.ts`) is available here, since
   * a fuzzy dictionary can be as large as the term vocabulary itself
   * (docs/guides/ranking-and-boosts.md#prefix-and-fuzzy-matching) but a query
   * only ever looks up a handful of specific deletion-variant keys —
   * the same "large dictionary, few keys touched per query" shape that
   * already justified the term shard's binary tier. `pins`/`synonyms`
   * stay plain file-strings above: both are small, author-curated data
   * with no binary encoding built (or currently justified) for them.
   */
  fuzzy?: Record<string, { file: string; format?: "json" | "binary" }>;
  /**
   * Vector/hybrid search (docs/guides/vector-search.md), only
   * present for a corpus built with a `vectors` option. `dims` and
   * `quantization` are corpus-wide (one embedding space per index, not
   * per language) — a query embedding must have exactly `dims` values
   * regardless of which language's shard it's compared against.
   * `embeddingProvider` tells the runtime what produced these vectors,
   * so it can fail clearly (`VectorSearchNotConfiguredError`) instead of
   * comparing a query embedding from the wrong model against the
   * corpus's vectors. `shards` is one file per language (matching the
   * `pins`/`synonyms`/`fuzzy` per-language-map shape above), not
   * doc-id-range-sharded further within a language yet — the same
   * single-shard-per-partition simplification the doc store itself
   * currently has (write-index.ts always emits one `docs/0.json`).
   */
  vectors?: {
    dims: number;
    quantization: "float32" | "int8";
    embeddingProvider: EmbeddingProviderConfig;
    shards: Record<string, string>;
  };
}

/**
 * Identifies what produced a corpus's vectors (docs/guides/vector-search.md#the-hard-constraint-where-does-the-query-embedding-come-from) —
 * this project doesn't run or validate any embedding model itself, so
 * this is metadata for the runtime/caller to act on, not something
 * `@ktjn/searchable-indexer`/`@ktjn/searchable-client` interpret internally. `"local-model"` and
 * `"remote-api"` mirror the two real query-time options the design doc
 * lays out; `"custom"` covers any other injectable `embed`/`embedQuery`
 * function a deployment supplies (including this repo's own tests,
 * which use a deterministic synthetic embedder, not a real model).
 */
export type EmbeddingProviderConfig =
  | { type: "local-model"; model: string }
  | { type: "remote-api" }
  | { type: "custom" };

/**
 * One passage's embedding (docs/guides/vector-search.md#chunking):
 * `passageId` back-references the chunk within its parent document
 * (`"<docId>-<chunkIndex>"`), `docId` is the parent document's id (same
 * id space as postings/doc store), and `vector` is `dims` numbers,
 * either raw float32-precision values or int8-quantized ones — see
 * `VectorShard.quantization`/`quantRange` for which and how to
 * interpret them.
 */
export interface VectorEntry {
  passageId: string;
  docId: number;
  vector: number[];
}

/**
 * One language's vector shard (docs/guides/vector-search.md#storage-format).
 * `quantization: "float32"` stores exact values as-is (JS/JSON numbers
 * are already float64-precision, so this is "no lossy quantization
 * applied" rather than a real 32-bit encoding); `"int8"` scalar-quantizes
 * every dimension of every vector in this shard against one shared
 * `quantRange` (a single corpus-wide min/max, not per-dimension) to an
 * integer in `[0, 255]`, per docs/guides/vector-search.md's "per-shard min/max scaling" --
 * `quantRange` is only present for that case, since a float32 shard has
 * nothing to dequantize.
 */
export interface VectorShard {
  dims: number;
  quantization: "float32" | "int8";
  quantRange?: { min: number; max: number };
  entries: VectorEntry[];
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
   * Document-level static boost (docs/guides/ranking-and-boosts.md), e.g.
   * from a searchable-boost meta tag. Denormalized onto every posting for this
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
  externalId?: string;
  contentHash?: string;
  metadata?: JsonValue;
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type DocStoreShard = Record<string, DocStoreEntry>;

export interface FacetValueEntry {
  /** Global count over the whole corpus, computed once at build time (docs/guides/facets.md#facet-counts). */
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
  /** Precomputed values for "terms"/"hierarchy" (per-value doc set + count); for "range", 5 equal-width buckets spanning the corpus's observed [min, max], keyed by a label like "10-20" or "80+" for the open-ended last bucket (docs/guides/facets.md#facet-index-structure). */
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

/** Synonym data (docs/guides/synonyms.md), both single-word and phrase-level. */
export interface SynonymShard {
  /** Symmetric equivalence classes: any term in a group expands the query to every other member. */
  equivalences?: string[][];
  /** Asymmetric: querying the key also matches the listed terms, but not vice versa. */
  directional?: Record<string, string[]>;
  /**
   * Symmetric phrase-level equivalence classes (docs/guides/synonyms.md#synonym-file-format):
   * any normalized phrase in a group (space-joined analyzed terms, the
   * same shape `normalizePhrase()` produces) expands a matching
   * `"quoted phrase"` query clause to every other phrase in the
   * group — e.g. `[["new york", "nyc", "big apple"]]` lets a `"new
   * york"` query also match a document containing the adjacent phrase
   * "big apple". Matched via the same real position-adjacency
   * verification a literal quoted phrase uses
   * (docs/guides/ranking-and-boosts.md#phrase-and-proximity-queries), not a
   * text-substitution shortcut. No directional (asymmetric) multiWord
   * form is defined — every group member expands to every other.
   */
  multiWord?: string[][];
}

/**
 * A SymSpell-style precomputed deletion dictionary for typo-tolerant
 * matching (docs/guides/ranking-and-boosts.md#prefix-and-fuzzy-matching).
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

export { canonicalize } from "./canonicalize.js";
export {
  DEFAULT_TRANSFORMERS_MODEL,
  type TransformersDtype,
} from "./transformers.js";
