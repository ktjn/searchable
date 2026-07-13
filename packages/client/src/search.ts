import {
  generateDeletes,
  getLanguageProfile,
  normalizePhrase,
  ownProp,
} from "@csf/analysis";
import type {
  DocStoreEntry,
  FacetShard,
  FuzzyShard,
  Manifest,
  PinsShard,
  Posting,
  SynonymShard,
  TermEntry,
  TermShard,
  VectorShard,
} from "@csf/format";
import {
  decodeBinaryDocStoreDirectory,
  decodeBinaryDocStoreEntry,
} from "./binary-doc-store.js";
import {
  decodeBinaryFuzzyEntry,
  decodeBinaryFuzzyShardDirectory,
} from "./binary-fuzzy-shard.js";
import {
  decodeBinaryTermEntry,
  decodeBinaryTermShardDirectory,
  termsWithBinaryPrefix,
} from "./binary-term-shard.js";
import type { ShardCache } from "./fetch-json.js";
import type { HighlightSpan, HighlightTerm } from "./highlight.js";
import { highlightText } from "./highlight.js";
import { parseQuery } from "./parse-query.js";
import { scoreTermForDoc } from "./score.js";
import type { VectorHit } from "./vector-search.js";
import {
  bruteForceVectorSearch,
  reciprocalRankFusion,
  VectorSearchNotConfiguredError,
} from "./vector-search.js";

export interface Hit {
  id: number;
  score: number;
  url: string;
  fields: Record<string, string>;
  /** Placed by a csf-pin match (docs/guides/pinning.md), not by relevance. */
  pinned?: boolean;
  /**
   * Per stored field, that field's text split into match/non-match
   * spans for the literal query terms typed (docs/reference/client-api.md#search-options-and-results).
   * Only present when `options.highlight` is true. A synonym- or
   * fuzzy-matched term that isn't also literally present in the query
   * is not highlighted — see packages/client/src/highlight.ts for why.
   */
  highlights?: Record<string, HighlightSpan[]>;
}

export interface FacetResultValue {
  value: string;
  count: number;
  selected: boolean;
}

export interface FacetResult {
  values: FacetResultValue[];
  /**
   * Only present for a hierarchical facet field (docs/guides/facets.md#facet-types):
   * the path separator joining segments within each `value` (e.g.
   * `"electronics>audio"` with separator `">"`), so a consumer can
   * reconstruct the tree by splitting on it rather than hardcoding a
   * delimiter. `values` already contains one flat entry per path level
   * (every ancestor plus each leaf), not just leaves.
   */
  separator?: string;
}

/** Inclusive bounds for a range-facet filter (docs/guides/facets.md#filtering). Omit either end for an open-ended range. */
export interface RangeFilter {
  min?: number;
  max?: number;
}

export interface SearchResult {
  hits: Hit[];
  /** Only present for facet fields the caller asked to include via options.facets. */
  facets?: Record<string, FacetResult>;
  totalHits: number;
  /**
   * The language this result set was actually resolved against
   * (`options.language ?? manifest.defaultLanguage`) — every hit in one
   * `SearchResult` comes from that single language's partition (terms
   * are sharded per-language, docs/guides/internationalization.md#mixed-language-corpora-and-queries),
   * so this is one value for the whole result, not per-hit. Lets a
   * consumer combine it with `@csf/analysis`'s `isRtlLanguage()`
   * (re-exported from this package) to set `dir="rtl"` on a results
   * container without duplicating its own language-resolution logic —
   * see docs/reference/client-api.md. The actual RTL
   * *layout* stays a consuming-app concern; this is just the one fact
   * the library already knows.
   */
  language: string;
  /**
   * Nearest real term(s) in the corpus for a query term that failed to
   * match at all, byproduct of the fuzzy dictionary
   * (docs/guides/ranking-and-boosts.md#did-you-mean-and-query-suggestions).
   * Only ever populated when `options.fuzzy` is true and the query
   * still returned zero hits (even after fuzzy expansion).
   */
  didYouMean?: string[];
}

export interface SearchOptions {
  language?: string;
  limit?: number;
  boosts?: {
    /** Per-query overrides of the manifest's build-time field boosts. */
    fields?: Record<string, number>;
    /**
     * Per-query multiplier on one specific query term's score
     * contribution (docs/guides/ranking-and-boosts.md#boost-types-summarized).
     * Keyed by the term as it appears *after* analysis (lowercased,
     * stemmed, etc.) — the same form stored in the term shard — not the
     * raw surface form the user typed.
     */
    terms?: Record<string, number>;
  };
  /**
   * Facet filters (docs/guides/facets.md#filtering): a string or
   * string[] for a terms facet (OR across an array of values within
   * one field, AND across different fields); a `{min?, max?}` range
   * for a range facet (docs/guides/facets.md#facet-index-structure) —
   * which shape applies is determined by the field's own facet shard
   * `type`, not declared here. A field with no matching facet shard in
   * the manifest is ignored rather than zeroing out the whole query —
   * a typo'd/unknown filter field is a build-time linting concern
   * elsewhere, not something a single query should hard-fail on.
   */
  filters?: Record<string, string | string[] | RangeFilter>;
  /**
   * Facet fields to compute contextual counts for and include in
   * `SearchResult.facets`. Counts are computed against the candidate
   * set with every *other* active filter applied but not this field's
   * own — the standard "how many if I also pick X" faceted-search
   * convention — so switching between values of the same facet shows
   * meaningful counts instead of the post-filter count for all of them.
   */
  facets?: string[];
  /**
   * Expand each non-prefix query term through the manifest's synonym
   * shard for the resolved language, if one exists
   * (docs/guides/synonyms.md). Off by default — a caller opts in per query,
   * matching this option's original design in docs/reference/client-api.md.
   * Prefix clauses (`term*`) are not synonym-expanded; combining the two
   * expansion mechanisms for one query slot isn't specified anywhere,
   * so this scopes them as independent.
   */
  synonyms?: boolean;
  /**
   * Score multiplier applied to a hit's contribution *only* when it
   * came from a synonym-expanded variant, not the literal query term
   * (docs/guides/synonyms.md#scoring-impact) — a document containing the
   * literal term still outranks one that only matches via synonym
   * expansion, all else equal. Only meaningful when `synonyms: true`.
   */
  synonymWeight?: number;
  /**
   * Expand each non-prefix query term into typo-tolerant matches from
   * the manifest's fuzzy (SymSpell deletion dictionary) shard for the
   * resolved language, if one exists
   * (docs/guides/ranking-and-boosts.md#prefix-and-fuzzy-matching). Off by
   * default. Same independence-from-prefix scoping decision as
   * `synonyms`.
   */
  fuzzy?: boolean;
  /**
   * Base score multiplier for a fuzzy-matched term, raised to the
   * power of its edit distance from the literal query term (so a
   * distance-2 match is penalized more than distance-1) — a document
   * containing the literal term still outranks a fuzzy-only match, all
   * else equal. Only meaningful when `fuzzy: true`.
   */
  fuzzyWeight?: number;
  /**
   * Compute `Hit.highlights` for every stored field of every hit
   * (docs/reference/client-api.md#search-options-and-results). Off by
   * default, matching every other opt-in query feature here — most
   * callers building a list UI want this, but it's extra work per hit
   * that a caller only rendering, say, a "did you mean" prompt doesn't
   * need to pay for.
   */
  highlight?: boolean;
  /**
   * Reject the in-flight `SearchClient.search()` call as soon as this
   * signal aborts (docs/reference/client-api.md#search-options-and-results)
   * — the primary building block for a keystroke-driven instant-search
   * box, where a superseded query must never resolve after (or
   * overwrite the results of) a newer one. Handled entirely by
   * `SearchClient` itself, not by this module's `search()` function: an
   * `AbortSignal` isn't structured-clone-able, so it's stripped before
   * a request ever reaches the Worker, and honoring it doesn't cancel
   * the underlying shard fetch either, since `ShardCache` memoizes
   * fetches across concurrent callers — aborting the shared network
   * request out from under a different, still-active query would be
   * wrong. This only cancels *waiting* on the result; the fetch that
   * was already in flight still completes and populates the cache
   * normally, it just won't be delivered to the caller who aborted.
   */
  signal?: AbortSignal;
  /**
   * Retrieval strategy (docs/guides/vector-search.md#api-surface).
   * `"lexical"` (default) is today's BM25F + boosts + synonyms/fuzzy
   * pipeline above, entirely unaffected by vector search. `"vector"`
   * embeds the query (via `SearchClientOptions.embedQuery`) and ranks
   * purely by cosine similarity against the manifest's vector shard for
   * the resolved language — a deliberate scope boundary for this first
   * slice: filters/facets/pins/highlighting are lexical-only features
   * and are not applied in this mode. `"hybrid"` runs the full lexical
   * pipeline (filters/facets/pins intact) and vector search
   * independently, then merges them (see `vectorWeight`). `"vector"`/
   * `"hybrid"` without a configured query-embedding source throws
   * `VectorSearchNotConfiguredError` rather than silently degrading to
   * lexical-only. Not supported in combination with `searchStream()`
   * (which never supplies a query embedding) — that combination also
   * throws `VectorSearchNotConfiguredError`.
   */
  mode?: "lexical" | "vector" | "hybrid";
  /**
   * Only meaningful for `mode: "hybrid"`. Omitted (the default) combines
   * the lexical and vector result lists via Reciprocal Rank Fusion
   * (docs/guides/vector-search.md#hybrid-search-combining-lexical-and-vector-scores) —
   * rank-based, so it needs no calibration between BM25F and cosine
   * similarity's incomparable scales. Passing a number in `[0, 1]`
   * switches to a min-max-normalized weighted-score combination instead
   * (`0` = lexical only, `1` = vector only) for callers who want to
   * hand-tune the tradeoff rather than accept RRF's rank-based default.
   */
  vectorWeight?: number;
}

/** docs/guides/synonyms.md#scoring-impact. */
const DEFAULT_SYNONYM_WEIGHT = 0.5;
/** docs/guides/ranking-and-boosts.md#prefix-and-fuzzy-matching. */
const DEFAULT_FUZZY_WEIGHT = 0.5;
/** How many "did you mean" suggestions to surface per unmatched query term. */
const MAX_SUGGESTIONS_PER_TERM = 3;

function resolve(baseUrl: string, relPath: string): string {
  return new URL(relPath, baseUrl).toString();
}

/** Whether `phraseTokens` appears as a contiguous run inside `queryTokens` (docs/guides/pinning.md#authoring, contains mode). */
function containsPhrase(
  queryTokens: string[],
  phraseTokens: string[],
): boolean {
  if (phraseTokens.length === 0 || phraseTokens.length > queryTokens.length) {
    return false;
  }
  for (let i = 0; i <= queryTokens.length - phraseTokens.length; i++) {
    if (phraseTokens.every((t, j) => queryTokens[i + j] === t)) return true;
  }
  return false;
}

/**
 * True if `docPostings` (one per phrase term, in order, all for the
 * same document) contain, for at least one shared field, a run of
 * consecutive positions matching that order -- i.e. the words
 * genuinely appear as an adjacent phrase in that field, not just
 * independently somewhere in the document
 * (docs/guides/ranking-and-boosts.md#phrase-and-proximity-queries). A
 * missing posting for any term (shouldn't happen -- callers only pass
 * doc ids already confirmed present in every term's postings) makes
 * this vacuously false rather than throwing.
 */
function hasConsecutivePositions(
  docPostings: (Posting | undefined)[],
): boolean {
  if (docPostings.length === 0 || docPostings.some((p) => !p)) return false;
  const first = docPostings[0];
  if (!first) return false;
  for (const field of Object.keys(first.fields)) {
    const positionSets = docPostings.map((p) => {
      const positions = p?.fields[field]?.pos;
      return positions ? new Set(positions) : undefined;
    });
    if (positionSets.some((s) => !s)) continue; // this field doesn't carry every term
    const startPositions = positionSets[0];
    if (!startPositions) continue;
    for (const start of startPositions) {
      let matched = true;
      for (let i = 1; i < positionSets.length; i++) {
        if (!positionSets[i]?.has(start + i)) {
          matched = false;
          break;
        }
      }
      if (matched) return true;
    }
  }
  return false;
}

function isRangeFilter(value: unknown): value is RangeFilter {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    ("min" in value || "max" in value)
  );
}

function valuesFor(
  filters: Record<string, string | string[] | RangeFilter> | undefined,
  field: string,
): string[] {
  const raw = filters?.[field];
  if (raw === undefined || isRangeFilter(raw)) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function rangeFilterFor(
  filters: Record<string, string | string[] | RangeFilter> | undefined,
  field: string,
): RangeFilter | undefined {
  const raw = filters?.[field];
  return isRangeFilter(raw) ? raw : undefined;
}

/** Fetches every facet shard in `fields` that actually exists in the manifest, keyed by field name. Shared by search() and facetValues() so they resolve facet shards identically. */
async function fetchFacetShards(
  manifest: Manifest,
  cache: ShardCache,
  baseUrl: string,
  fields: string[],
): Promise<Map<string, FacetShard>> {
  const entries = (manifest.shards.facets ?? []).filter((s) =>
    fields.includes(s.field),
  );
  const fetched = await Promise.all(
    entries.map(
      async (entry) =>
        [
          entry.field,
          await cache.fetchJson<FacetShard>(resolve(baseUrl, entry.file)),
        ] as const,
    ),
  );
  return new Map(fetched);
}

/**
 * Every doc id matching the active filter on `field` (terms: OR across
 * selected values; range: min/max scan of the sorted array). Shared by
 * search() (candidate narrowing) and facetValues() (contextual counts
 * against every *other* active filter).
 */
function unionDocsForField(
  facetShardsByField: Map<string, FacetShard>,
  filters: Record<string, string | string[] | RangeFilter> | undefined,
  field: string,
): Set<number> {
  const shard = facetShardsByField.get(field);
  const ids = new Set<number>();
  if (!shard) return ids;
  if (shard.type === "range") {
    const range = rangeFilterFor(filters, field);
    if (!range) return ids;
    // Linear scan over the sorted array rather than a binary-search
    // range lookup -- correct either way since the array is sorted,
    // and a full scan is negligible at "small corpus" JSON-tier
    // scale (docs/guides/indexing.md#what-to-simplify-at-this-scale).
    // Binary-searching the two endpoints is a documented future
    // optimization once shard size actually makes it matter.
    for (const entry of shard.sorted ?? []) {
      if (range.min !== undefined && entry.value < range.min) continue;
      if (range.max !== undefined && entry.value > range.max) continue;
      ids.add(entry.doc);
    }
    return ids;
  }
  for (const value of valuesFor(filters, field)) {
    for (const id of shard.values[value]?.docs ?? []) ids.add(id);
  }
  return ids;
}

/** Every other term `term` expands to via the synonym shard's equivalence classes and directional map (docs/guides/synonyms.md). */
function synonymVariantsFor(
  term: string,
  synonymShard: SynonymShard | undefined,
): string[] {
  if (!synonymShard) return [];
  const variants = new Set<string>();
  for (const group of synonymShard.equivalences ?? []) {
    if (!group.includes(term)) continue;
    for (const variant of group) {
      if (variant !== term) variants.add(variant);
    }
  }
  const directionalVariants = synonymShard.directional
    ? ownProp(synonymShard.directional, term)
    : undefined;
  for (const variant of directionalVariants ?? []) {
    variants.add(variant);
  }
  return [...variants];
}

/**
 * Every other normalized phrase `normalizedPhrase` expands to via the
 * synonym shard's `multiWord` equivalence classes
 * (docs/guides/synonyms.md#synonym-file-format) — symmetric only, no
 * directional multiWord form is defined. `normalizedPhrase` must
 * already be in the same space-joined-analyzed-terms shape
 * `normalizePhrase()`/the indexer's `buildSynonymShards()` produce.
 */
function multiWordVariantsFor(
  normalizedPhrase: string,
  synonymShard: SynonymShard | undefined,
): string[] {
  if (!synonymShard) return [];
  const variants = new Set<string>();
  for (const group of synonymShard.multiWord ?? []) {
    if (!group.includes(normalizedPhrase)) continue;
    for (const variant of group) {
      if (variant !== normalizedPhrase) variants.add(variant);
    }
  }
  return [...variants];
}

/** Levenshtein edit distance, code-point aware. */
function levenshteinDistance(a: string, b: string): number {
  const s = [...a];
  const t = [...b];
  const prevRow = new Array<number>(t.length + 1);
  for (let j = 0; j <= t.length; j++) prevRow[j] = j;

  for (let i = 1; i <= s.length; i++) {
    let diag = prevRow[0] ?? 0;
    prevRow[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const temp = prevRow[j] ?? 0;
      prevRow[j] =
        s[i - 1] === t[j - 1]
          ? diag
          : 1 + Math.min(diag, prevRow[j] ?? 0, prevRow[j - 1] ?? 0);
      diag = temp;
    }
  }
  return prevRow[t.length] ?? 0;
}

/**
 * A fuzzy dictionary lookup, abstracting over whether the shard behind
 * it is a plain JSON `FuzzyShard` (already fully in memory, `get()` is a
 * direct property read) or a binary shard (`./binary-fuzzy-shard.js`,
 * `get()` lazily decodes just the requested deletion-variant's entry
 * from an already-fetched byte buffer) — every caller below only ever
 * needs a handful of specific variant keys per query
 * (`generateDeletes()`'s expansion of the query terms actually typed),
 * never the whole dictionary, so this is the same "decode only what a
 * query touches" property the binary term shard tier already relies on.
 */
interface FuzzyLookup {
  maxEdits: 1 | 2;
  get(variant: string): string[];
}

/**
 * Hard cap on how many distinct dictionary candidates a single fuzzy
 * lookup will Levenshtein-score (issue #1 finding 8), regardless of how
 * many deletion-variant buckets matched. A dense vocabulary (many terms
 * within a couple of edits of each other) or a common short deletion key
 * can otherwise return an unbounded candidate set, and Levenshtein
 * distance is computed for every one of them -- this bounds worst-case
 * per-term CPU cost independent of dictionary size or shape. Candidates
 * beyond the cap are dropped *before* scoring (the point is avoiding the
 * O(candidates) distance computation itself, not just trimming the
 * result list afterward), so this is a safety valve against pathological
 * density, not a "keep the best N" ranking — which candidates survive
 * past the cap depends on `Set` insertion order, not distance.
 */
const MAX_FUZZY_CANDIDATES_PER_TERM = 200;

/**
 * Every real term discoverable from `term` via the deletion dictionary
 * (a fast candidate generator, not a distance oracle), each paired with
 * its true Levenshtein distance from `term`. Excludes `term` itself
 * (distance 0 — that's an exact match, not a fuzzy one). Deliberately
 * unfiltered by any maxEdits cutoff here (see `fuzzyMatchesFor` for
 * that) — the query-side deletion depth already matches
 * `lookup.maxEdits` (needed to find genuine matches at that
 * distance at all, see `generateDeletes`'s doc comment), and the
 * symmetric-delete lookup can additionally surface occasional
 * true-distance-(maxEdits+1) hits too (e.g. an adjacent-character
 * transposition landing one delete short on each side). Callers decide
 * how strict to be.
 */
function fuzzyCandidatesFor(
  term: string,
  lookup: FuzzyLookup | undefined,
): { term: string; distance: number }[] {
  if (!lookup) return [];
  const candidates = new Set<string>();
  for (const t of lookup.get(term)) candidates.add(t);
  for (const deletion of generateDeletes(term, lookup.maxEdits)) {
    for (const t of lookup.get(deletion)) candidates.add(t);
  }
  let candidateTerms = [...candidates];
  if (candidateTerms.length > MAX_FUZZY_CANDIDATES_PER_TERM) {
    console.warn(
      `[csf-client] fuzzy lookup for "${term}" found ${candidateTerms.length} dictionary candidates, over the ${MAX_FUZZY_CANDIDATES_PER_TERM}-candidate cap -- scoring only the first ${MAX_FUZZY_CANDIDATES_PER_TERM} (not necessarily the closest). A dense vocabulary this large may want a shorter query term, a smaller fuzzyMaxEdits, or this project's benchmarking data to size the tradeoff (docs/project/governance.md).`,
    );
    candidateTerms = candidateTerms.slice(0, MAX_FUZZY_CANDIDATES_PER_TERM);
  }
  const matches: { term: string; distance: number }[] = [];
  for (const candidate of candidateTerms) {
    if (candidate === term) continue;
    matches.push({
      term: candidate,
      distance: levenshteinDistance(term, candidate),
    });
  }
  return matches;
}

/**
 * The maximum edit distance to accept as a genuine fuzzy match for
 * `term`, capping `shardMaxEdits` down for short terms
 * (docs/guides/ranking-and-boosts.md#prefix-and-fuzzy-matching: fuzzy
 * matching is "length- and language-dependent"). A term of 3 code
 * points or fewer is too short for a distance-2 match to mean much —
 * almost any other short term is within 2 edits of it — so it's capped
 * at distance-1 regardless of what the dictionary itself supports.
 * This same length rule doubles as the "language-dependent" half: CJK
 * bigram-indexed languages (docs/guides/internationalization.md#segmentation)
 * index every term as a 1- or 2-character bigram, so this cap already
 * restricts them to distance-1 fuzzy matching with no CJK-specific
 * logic needed.
 */
function effectiveMaxEdits(term: string, shardMaxEdits: 1 | 2): number {
  return [...term].length <= 3 ? Math.min(1, shardMaxEdits) : shardMaxEdits;
}

/**
 * Real terms within `term`'s effective maxEdits (docs/guides/ranking-and-boosts.md#prefix-and-fuzzy-matching)
 * — the strict subset of `fuzzyCandidatesFor` used for query expansion.
 */
function fuzzyMatchesFor(
  term: string,
  lookup: FuzzyLookup | undefined,
): { term: string; distance: number }[] {
  if (!lookup) return [];
  const cap = effectiveMaxEdits(term, lookup.maxEdits);
  return fuzzyCandidatesFor(term, lookup).filter(
    (match) => match.distance <= cap,
  );
}

/**
 * The `limit` nearest real terms to `term`, distance ascending (ties
 * broken alphabetically) — used for "did you mean" suggestions, which
 * deliberately does NOT apply `fuzzyMatchesFor`'s maxEdits cutoff: a
 * term that failed strict fuzzy matching (and is therefore a candidate
 * for suggestion in the first place) can still have discoverable
 * distance-2 candidates worth surfacing.
 */
function nearestTermsFor(
  term: string,
  lookup: FuzzyLookup | undefined,
  limit: number,
): string[] {
  return fuzzyCandidatesFor(term, lookup)
    .sort((a, b) => a.distance - b.distance || a.term.localeCompare(b.term))
    .slice(0, limit)
    .map((match) => match.term);
}

/**
 * Resolves `language`'s fuzzy shard, if the manifest has one, into a
 * `FuzzyLookup` -- a JSON shard is fetched and fully parsed up front (as
 * before), a binary shard fetches+decodes only its directory here, then
 * decodes individual deletion-variant entries lazily as `get()` is
 * called during clause resolution below, from the same already-fetched
 * byte buffer (`ShardCache` memoizes the fetch itself).
 */
async function loadFuzzyLookup(
  manifest: Manifest,
  cache: ShardCache,
  baseUrl: string,
  language: string,
): Promise<FuzzyLookup | undefined> {
  const entry = manifest.fuzzy && ownProp(manifest.fuzzy, language);
  if (!entry) return undefined;
  if (entry.format === "binary") {
    const bytes = await cache.fetchArrayBuffer(resolve(baseUrl, entry.file));
    const directory = decodeBinaryFuzzyShardDirectory(bytes);
    return {
      maxEdits: directory.maxEdits,
      get: (variant) => {
        const location = directory.index.get(variant);
        return location
          ? decodeBinaryFuzzyEntry(
              bytes,
              directory.directoryByteLength,
              location.offset,
            )
          : [];
      },
    };
  }
  const shard = await cache.fetchJson<FuzzyShard>(resolve(baseUrl, entry.file));
  return {
    maxEdits: shard.maxEdits,
    get: (variant) => ownProp(shard.deletions, variant) ?? [],
  };
}

/**
 * `"all"` is a reserved shard-prefix value (docs/concepts/index-format.md#term-shard-inverted-index)
 * meaning "this shard holds the entire vocabulary for its language,"
 * not a literal character prefix -- unlike every other prefix value,
 * which *is* a real leading substring of every term inside it. Emitted
 * by `writeIndex(built, outDir, { shardByPrefix: false })`
 * (docs/guides/indexing.md's small-corpus mode) and by
 * both independent reference generators
 * (spec/examples/{python,typescript}/), so any conformant producer's
 * output can use it, not just this project's own indexer.
 */
const UNSHARDED_TERM_SHARD_PREFIX = "all";

/**
 * The term shard entries a query actually needs, out of every shard for
 * `language` (docs/concepts/index-format.md#term-shard-inverted-index): shards
 * partition the vocabulary disjointly by first-character (or, for an
 * over-large bucket, first-two-character) prefix, so an exact term only
 * ever lives in the one shard whose prefix it starts with, and a prefix
 * query (`term*`) only ever needs shards whose prefix *overlaps* the
 * query's prefix -- either is a prefix of the other, since the query
 * prefix and a shard's prefix can differ in length (a single-char query
 * prefix against two-char shards, or vice versa). An `"all"` shard
 * (`UNSHARDED_TERM_SHARD_PREFIX` above) always matches, since it's not
 * a real prefix to test membership against. Fetching only this subset
 * (rather than every shard for the language, regardless of which terms
 * a query actually mentions) is the whole point of prefix sharding:
 * first-query cost stays flat as the corpus grows instead of scaling
 * with total vocabulary size (docs/concepts/binary-storage.md).
 */
function shardEntriesForQuery(
  shardEntries: Manifest["shards"]["terms"],
  exactTermsNeeded: Set<string>,
  prefixesNeeded: string[],
): Manifest["shards"]["terms"] {
  return shardEntries.filter((entry) => {
    if (entry.prefix === UNSHARDED_TERM_SHARD_PREFIX) return true;
    for (const term of exactTermsNeeded) {
      if (term.startsWith(entry.prefix)) return true;
    }
    for (const p of prefixesNeeded) {
      if (entry.prefix.startsWith(p) || p.startsWith(entry.prefix)) return true;
    }
    return false;
  });
}

/**
 * Boolean-AND query evaluation over the shards a query actually needs
 * (docs/concepts/architecture.md#data-flow-for-a-query): analyze the query
 * with the same LanguageProfile the indexer used, fetch only the term
 * shard(s) covering the matched language *and* the specific terms/prefixes
 * this query touches (`shardEntriesForQuery` above), intersect posting
 * doc-id sets across every query term, score the intersection with
 * BM25F, and fetch doc-store data for only the final top-N hits. Facet
 * filters narrow the candidate set before scoring; pins are resolved
 * independently of the organic query and spliced onto the front of the
 * result (docs/guides/pinning.md).
 */
async function lexicalSearch(
  query: string,
  manifest: Manifest,
  cache: ShardCache,
  baseUrl: string,
  options: SearchOptions = {},
): Promise<SearchResult> {
  const language = options.language ?? manifest.defaultLanguage;
  const profile = getLanguageProfile(language);

  const parsedQuery = parseQuery(query, profile);
  const queryTerms = parsedQuery.terms;
  if (queryTerms.length === 0 && parsedQuery.phrases.length === 0) {
    return { hits: [], totalHits: 0, language };
  }

  const shardEntries = manifest.shards.terms.filter((s) => s.lang === language);

  // synonym/fuzzy shards are independent of term-shard sharding (they're
  // one shard per language, not per prefix), so they're fetched first --
  // resolving them now (rather than lazily inside the clause loop below)
  // lets their variant/candidate terms feed the term-shard *selection*
  // below, not just clause resolution afterwards.
  const synonymsFile =
    options.synonyms && manifest.synonyms
      ? ownProp(manifest.synonyms, language)
      : undefined;
  const synonymShard = synonymsFile
    ? await cache.fetchJson<SynonymShard>(resolve(baseUrl, synonymsFile))
    : undefined;
  const synonymWeight = options.synonymWeight ?? DEFAULT_SYNONYM_WEIGHT;

  const fuzzyLookup = options.fuzzy
    ? await loadFuzzyLookup(manifest, cache, baseUrl, language)
    : undefined;
  const fuzzyWeight = options.fuzzyWeight ?? DEFAULT_FUZZY_WEIGHT;

  // Every exact term (and every synonym/fuzzy candidate variant of one)
  // and every prefix-query prefix this query could possibly need a
  // dictionary lookup for -- computed before any term shard is fetched,
  // so only the shards actually covering them get fetched at all.
  const exactTermsNeeded = new Set<string>();
  const prefixesNeeded: string[] = [];
  for (const qt of queryTerms) {
    if (qt.prefix) {
      prefixesNeeded.push(qt.term);
      continue;
    }
    exactTermsNeeded.add(qt.term);
    for (const variant of synonymVariantsFor(qt.term, synonymShard)) {
      exactTermsNeeded.add(variant);
    }
    for (const match of fuzzyMatchesFor(qt.term, fuzzyLookup)) {
      exactTermsNeeded.add(match.term);
    }
  }
  for (const phrase of parsedQuery.phrases) {
    const literalWords = phrase.terms.map((qt) => qt.term);
    for (const word of literalWords) exactTermsNeeded.add(word);
    if (options.synonyms && synonymShard) {
      for (const variant of multiWordVariantsFor(
        literalWords.join(" "),
        synonymShard,
      )) {
        for (const word of variant.split(" ")) exactTermsNeeded.add(word);
      }
    }
  }

  const neededShardEntries = shardEntriesForQuery(
    shardEntries,
    exactTermsNeeded,
    prefixesNeeded,
  );
  const termLookup = new Map<string, TermEntry>();
  await Promise.all(
    neededShardEntries.map(async (entry) => {
      if (entry.format === "binary") {
        // Binary directories expose per-term offsets, so decode only matched entries.
        const bytes = await cache.fetchArrayBuffer(
          resolve(baseUrl, entry.file),
        );
        const { sortedTerms, index, directoryByteLength } =
          decodeBinaryTermShardDirectory(bytes);
        const termsToDecode = new Set<string>();
        for (const term of exactTermsNeeded) {
          if (index.has(term)) termsToDecode.add(term);
        }
        for (const p of prefixesNeeded) {
          for (const term of termsWithBinaryPrefix(sortedTerms, p)) {
            termsToDecode.add(term);
          }
        }
        for (const term of termsToDecode) {
          const location = index.get(term);
          if (!location) continue;
          termLookup.set(
            term,
            decodeBinaryTermEntry(bytes, directoryByteLength, location.offset),
          );
        }
      } else {
        const shard = await cache.fetchJson<TermShard>(
          resolve(baseUrl, entry.file),
        );
        for (const [term, e] of Object.entries(shard)) {
          termLookup.set(term, e);
        }
      }
    }),
  );

  // Each query term becomes a clause: an exact term matches at most one
  // TermEntry (plus, when synonyms/fuzzy are enabled, any equivalence/
  // directional variant or typo-tolerant match that also has a
  // dictionary entry, each scored at a reduced weight relative to the
  // literal term), a prefix (`term*`) matches every real term starting
  // with it — resolved here by scanning the already-fetched shard's
  // term dictionary (a contiguous range scan over a sorted structure at
  // larger scale, per docs/concepts/index-format.md#size-targets-and-sharding-tuning,
  // but a plain filter is exact and sufficient at this corpus size). A
  // clause with zero matches fails the organic query (boolean AND) —
  // but not pin matching, which runs independently below. Every query
  // term is processed (not just up to the first failure) so
  // `failedTerms` below can drive "did you mean" suggestions for every
  // term that didn't match, not only the first one.
  interface ClauseEntry {
    entry: TermEntry;
    /** 1.0 for the literal/prefix-matched term, otherwise a synonym/fuzzy penalty weight. */
    weight: number;
  }
  const clauses: { term: string; entries: ClauseEntry[] }[] = [];
  const failedTerms: string[] = [];
  let anyClauseFailed = false;
  for (const qt of queryTerms) {
    let clauseEntries: ClauseEntry[];
    if (qt.prefix) {
      clauseEntries = [...termLookup.entries()]
        .filter(([term]) => term.startsWith(qt.term))
        .map(([, entry]) => ({ entry, weight: 1.0 }));
    } else {
      clauseEntries = [];
      const addedTerms = new Set<string>();
      const exact = termLookup.get(qt.term);
      if (exact) {
        clauseEntries.push({ entry: exact, weight: 1.0 });
        addedTerms.add(qt.term);
      }
      for (const variant of synonymVariantsFor(qt.term, synonymShard)) {
        if (addedTerms.has(variant)) continue;
        const variantEntry = termLookup.get(variant);
        if (variantEntry) {
          clauseEntries.push({ entry: variantEntry, weight: synonymWeight });
          addedTerms.add(variant);
        }
      }
      for (const match of fuzzyMatchesFor(qt.term, fuzzyLookup)) {
        if (addedTerms.has(match.term)) continue;
        const fuzzyEntry = termLookup.get(match.term);
        if (fuzzyEntry) {
          clauseEntries.push({
            entry: fuzzyEntry,
            weight: fuzzyWeight ** match.distance,
          });
          addedTerms.add(match.term);
        }
      }
    }
    if (clauseEntries.length === 0) {
      anyClauseFailed = true;
      if (!qt.prefix) failedTerms.push(qt.term);
    } else {
      clauses.push({ term: qt.term, entries: clauseEntries });
    }
  }

  // Each `"quoted phrase"` clause resolves independently of the plain
  // terms above, as one or more "attempts": the literal phrase itself
  // (weight 1.0), plus -- when options.synonyms is on and a matching
  // `multiWord` equivalence group exists (docs/guides/synonyms.md#synonym-file-format) --
  // every other phrase in that group, each at `synonymWeight`, exactly
  // mirroring how a single-word synonym variant is an extra,
  // reduced-weight attempt alongside the literal term. Every attempt's
  // words must exist in the dictionary (exact lookup only -- no
  // prefix/fuzzy expansion inside a phrase, out of scope for this
  // slice) *and* appear at consecutive positions, in order, within some
  // shared field of a candidate document (`hasConsecutivePositions()`)
  // -- not merely be independently present the way a bare AND of the
  // same words already requires. An attempt with a word missing from
  // the dictionary is silently skipped (same tolerance single-word
  // synonym variants get); only the *literal* phrase's own missing
  // words feed `failedTerms` for "did you mean" -- a missing word
  // inside a synonym-variant phrase isn't a real query-term typo to
  // suggest a fix for. The whole clause fails only if every attempt
  // (literal and every variant) found zero matching documents.
  const termClauseCount = clauses.length; // boundary before any phrase-derived entries are appended below
  const phraseMatchedDocSets: Set<number>[] = [];
  for (const phrase of parsedQuery.phrases) {
    const literalWords = phrase.terms.map((qt) => qt.term);
    const attempts: { words: string[]; weight: number }[] = [
      { words: literalWords, weight: 1.0 },
    ];
    if (options.synonyms && synonymShard) {
      for (const variant of multiWordVariantsFor(
        literalWords.join(" "),
        synonymShard,
      )) {
        attempts.push({ words: variant.split(" "), weight: synonymWeight });
      }
    }

    const totalMatchedDocs = new Set<number>();
    for (const attempt of attempts) {
      const attemptEntries: TermEntry[] = [];
      let allWordsFound = true;
      for (const word of attempt.words) {
        const entry = termLookup.get(word);
        if (entry) {
          attemptEntries.push(entry);
        } else {
          allWordsFound = false;
          if (attempt.weight === 1.0 && !failedTerms.includes(word)) {
            failedTerms.push(word);
          }
        }
      }
      if (!allWordsFound) continue;

      const wordDocSets = attemptEntries.map(
        (entry) => new Set(entry.postings.map((p) => p.doc)),
      );
      const [firstWordDocs, ...restWordDocs] = wordDocSets;
      const commonDocIds = [...(firstWordDocs ?? [])].filter((id) =>
        restWordDocs.every((set) => set.has(id)),
      );
      const attemptMatchedDocs = new Set<number>();
      for (const docId of commonDocIds) {
        const docPostings = attemptEntries.map((entry) =>
          entry.postings.find((p) => p.doc === docId),
        );
        if (hasConsecutivePositions(docPostings)) attemptMatchedDocs.add(docId);
      }
      for (const docId of attemptMatchedDocs) totalMatchedDocs.add(docId);

      // Each attempt's words contribute to scoring/highlighting like an
      // ordinary literal term clause, but restricted (via a postings
      // filter, not just relying on the outer candidateSet gate) to the
      // docs *this specific attempt* adjacency-matched -- required now
      // that a phrase clause can succeed via more than one attempt: a
      // doc that only matched through a lower-weight synonym variant
      // must not also get scored as if the literal phrase matched there.
      for (const [i, word] of attempt.words.entries()) {
        const entry = attemptEntries[i];
        if (!entry) continue;
        const restrictedEntry: TermEntry = {
          df: entry.df,
          postings: entry.postings.filter((p) => attemptMatchedDocs.has(p.doc)),
        };
        clauses.push({
          term: word,
          entries: [{ entry: restrictedEntry, weight: attempt.weight }],
        });
      }
    }

    if (totalMatchedDocs.size === 0) anyClauseFailed = true;
    phraseMatchedDocSets.push(totalMatchedDocs);
  }

  const organicMatched = !anyClauseFailed;

  let organicCandidateIds: number[] = [];
  if (organicMatched) {
    const termClauseDocSets = clauses
      .slice(0, termClauseCount)
      .map((clause) => {
        const ids = new Set<number>();
        for (const { entry } of clause.entries) {
          for (const posting of entry.postings) ids.add(posting.doc);
        }
        return ids;
      });
    const allDocSets = [...termClauseDocSets, ...phraseMatchedDocSets];
    const [first, ...rest] = allDocSets;
    organicCandidateIds = [...(first ?? [])].filter((id) =>
      rest.every((set) => set.has(id)),
    );
  }

  // --- facet shards needed for filtering and/or requested facet display ---
  const filterFields = Object.keys(options.filters ?? {});
  const requestedFacetFields = options.facets ?? [];
  const neededFields = [...new Set([...filterFields, ...requestedFacetFields])];
  const facetShardsByField = await fetchFacetShards(
    manifest,
    cache,
    baseUrl,
    neededFields,
  );

  const activeFilterFields = filterFields.filter((f) =>
    facetShardsByField.has(f),
  );
  const filterUnionSets = new Map(
    activeFilterFields.map((f) => [
      f,
      unionDocsForField(facetShardsByField, options.filters, f),
    ]),
  );

  // Organic candidates after applying every active filter (AND across fields).
  let candidateIds = organicCandidateIds;
  for (const unionSet of filterUnionSets.values()) {
    candidateIds = candidateIds.filter((id) => unionSet.has(id));
  }
  const candidateSet = new Set(candidateIds);

  // Every clause's postings for candidateSet members get scored up
  // front regardless of pin/exclusive status — cheap, and lets a
  // pinned hit that's also an organic match report its real BM25F
  // score instead of a fabricated one.
  const scores = new Map<number, number>();
  const docBoosts = new Map<number, number>();
  for (const clause of clauses) {
    const termBoost = options.boosts?.terms?.[clause.term] ?? 1.0;
    for (const { entry, weight } of clause.entries) {
      for (const posting of entry.postings) {
        if (!candidateSet.has(posting.doc)) continue;
        const s =
          scoreTermForDoc(
            posting,
            entry.df,
            manifest,
            language,
            options.boosts?.fields,
          ) *
          termBoost *
          weight;
        scores.set(posting.doc, (scores.get(posting.doc) ?? 0) + s);
        if (posting.boost !== undefined)
          docBoosts.set(posting.doc, posting.boost);
      }
    }
  }
  function scoreOf(id: number): number {
    return (scores.get(id) ?? 0) * (docBoosts.get(id) ?? 1.0);
  }

  // --- pins (docs/guides/pinning.md), resolved independently
  // of whether the organic query matched anything ---
  const normalizedQuery = normalizePhrase(query, profile);
  const pinsFile = manifest.pins && ownProp(manifest.pins, language);
  let matchedPins: { id: number; priority: number; exclusive: boolean }[] = [];
  if (pinsFile && normalizedQuery) {
    const pinsShard = await cache.fetchJson<PinsShard>(
      resolve(baseUrl, pinsFile),
    );
    const queryTokens = normalizedQuery.split(" ");
    for (const [phrase, entry] of Object.entries(pinsShard)) {
      const matches =
        entry.mode === "exact"
          ? phrase === normalizedQuery
          : containsPhrase(queryTokens, phrase.split(" "));
      if (matches) matchedPins.push(...entry.docs);
    }
    // Highest priority first; stable sort keeps ties in build order.
    matchedPins.sort((a, b) => b.priority - a.priority);
    const seenIds = new Set<number>();
    matchedPins = matchedPins.filter((d) => {
      if (seenIds.has(d.id)) return false;
      seenIds.add(d.id);
      return true;
    });
    // An explicit active filter that excludes a pinned page hides that
    // pin — a user's deliberate filter takes precedence over an
    // author's pin (docs/guides/pinning.md#authoring, "interaction with active facet filters").
    if (activeFilterFields.length > 0) {
      matchedPins = matchedPins.filter((d) =>
        activeFilterFields.every((f) => filterUnionSets.get(f)?.has(d.id)),
      );
    }
  }

  const isExclusive = matchedPins.some((d) => d.exclusive);
  const limit = options.limit ?? 10;
  const pinnedForDisplay = matchedPins.slice(0, limit);
  const pinnedIdSet = new Set(pinnedForDisplay.map((d) => d.id));

  // A matching exclusive pin skips the organic query entirely
  // (docs/guides/pinning.md#what-happens-at-query-time) — pinned hits are the whole result.
  const rankedOrganic = isExclusive
    ? []
    : candidateIds
        .filter((id) => !pinnedIdSet.has(id))
        .map((id) => ({ id, score: scoreOf(id) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(0, limit - pinnedForDisplay.length));

  const allResultIds = [
    ...pinnedForDisplay.map((d) => d.id),
    ...rankedOrganic.map((r) => r.id),
  ];
  const docLookup = await fetchDocStoreEntriesByIds(
    manifest,
    cache,
    baseUrl,
    allResultIds,
  );

  // Highlighting matches raw stored text, so it needs each query term's
  // literal (lowercased-only) surface form, not the stemmed form used
  // for matching -- a stemmed "widget" wouldn't `\b`-match inside the
  // literal stored text "Widgets".
  const highlightTerms: HighlightTerm[] = [
    ...queryTerms.map((qt) => ({ term: qt.literal, prefix: qt.prefix })),
    ...parsedQuery.phrases.flatMap((phrase) =>
      phrase.terms.map((qt) => ({ term: qt.literal, prefix: false })),
    ),
  ];

  function toHit(id: number, score: number, pinned: boolean): Hit {
    const doc = docLookup.get(id);
    const fields = doc?.fields ?? {};
    const highlights = options.highlight
      ? Object.fromEntries(
          Object.entries(fields).map(([field, text]) => [
            field,
            highlightText(text, highlightTerms),
          ]),
        )
      : undefined;
    return {
      id,
      score,
      url: doc?.url ?? "",
      fields,
      ...(pinned ? { pinned: true } : {}),
      ...(highlights ? { highlights } : {}),
    };
  }

  const hits: Hit[] = [
    ...pinnedForDisplay.map((d) => toHit(d.id, scoreOf(d.id), true)),
    ...rankedOrganic.map((r) => toHit(r.id, r.score, false)),
  ];

  const totalHits = isExclusive
    ? pinnedForDisplay.length
    : new Set([...candidateIds, ...pinnedForDisplay.map((d) => d.id)]).size;

  // --- facet results: contextual counts against the candidate set with
  // every *other* active filter applied but not this field's own ---
  let facets: Record<string, FacetResult> | undefined;
  if (requestedFacetFields.length) {
    facets = {};
    for (const field of requestedFacetFields) {
      const shard = facetShardsByField.get(field);
      if (!shard) continue;
      let baseSet = new Set(organicCandidateIds);
      for (const [otherField, unionSet] of filterUnionSets) {
        if (otherField === field) continue;
        baseSet = new Set([...baseSet].filter((id) => unionSet.has(id)));
      }
      const selectedValues = new Set(valuesFor(options.filters, field));
      // For a range-type shard, `shard.values` is always {} (no
      // precomputed buckets yet, see FacetShard.values doc comment in
      // @csf/format) -- this naturally produces an empty `values`
      // array rather than a bucketed histogram, since aggregate range
      // facet results are deferred; range *filtering* (unionDocsForField
      // above) works today regardless.
      facets[field] = {
        values: Object.entries(shard.values).map(([value, entry]) => ({
          value,
          count: entry.docs.filter((id) => baseSet.has(id)).length,
          selected: selectedValues.has(value),
        })),
        ...(shard.type === "hierarchy"
          ? { separator: shard.separator ?? ">" }
          : {}),
      };
    }
  }

  // --- "did you mean" (docs/guides/ranking-and-boosts.md#did-you-mean-and-query-suggestions):
  // a byproduct of the fuzzy dictionary, only computed when the caller
  // opted into fuzzy matching and the query still returned nothing ---
  let didYouMean: string[] | undefined;
  if (
    options.fuzzy &&
    fuzzyLookup &&
    hits.length === 0 &&
    failedTerms.length > 0
  ) {
    const suggestions = new Set<string>();
    for (const term of failedTerms) {
      for (const candidate of nearestTermsFor(
        term,
        fuzzyLookup,
        MAX_SUGGESTIONS_PER_TERM,
      )) {
        suggestions.add(candidate);
      }
    }
    if (suggestions.size > 0) didYouMean = [...suggestions];
  }

  return {
    hits,
    ...(facets ? { facets } : {}),
    totalHits,
    language,
    ...(didYouMean ? { didYouMean } : {}),
  };
}

/**
 * Fetches doc-store entries for exactly the given ids, from whichever
 * doc shard(s) cover them — shared by `lexicalSearch`'s inline hit
 * assembly and vector/hybrid result assembly (which builds its hit list
 * from a different candidate set). A binary-format shard
 * (`./binary-doc-store.js`) decodes only the requested ids by seeking
 * directly to each one's byte range, never the whole store — the only
 * doc store shard today covers the *entire* corpus regardless of size
 * (`write-index.ts` always emits one `docs/0.json`), so this is a real
 * win any time a query's hit count is a small fraction of the corpus. A
 * JSON-format shard still parses in full (as before), same as term
 * shards' own JSON path — `JSON.parse` has no partial-decode option.
 */
async function fetchDocStoreEntriesByIds(
  manifest: Manifest,
  cache: ShardCache,
  baseUrl: string,
  ids: number[],
): Promise<Map<number, DocStoreEntry>> {
  const docShardEntries = manifest.shards.docs.filter((d) =>
    ids.some((id) => id >= d.idRange[0] && id <= d.idRange[1]),
  );
  const idSet = new Set(ids);
  const docLookup = new Map<number, DocStoreEntry>();
  await Promise.all(
    docShardEntries.map(async (entry) => {
      if (entry.format === "binary") {
        const bytes = await cache.fetchArrayBuffer(
          resolve(baseUrl, entry.file),
        );
        const directory = decodeBinaryDocStoreDirectory(bytes);
        for (const id of idSet) {
          const location = directory.index.get(id);
          if (!location) continue;
          docLookup.set(
            id,
            decodeBinaryDocStoreEntry(
              bytes,
              directory.directoryByteLength,
              location.offset,
            ),
          );
        }
      } else {
        const shard = await cache.fetchJson<Record<string, DocStoreEntry>>(
          resolve(baseUrl, entry.file),
        );
        for (const [id, docEntry] of Object.entries(shard)) {
          docLookup.set(Number(id), docEntry);
        }
      }
    }),
  );
  return docLookup;
}

function docStoreEntryToHit(
  id: number,
  score: number,
  doc?: DocStoreEntry,
): Hit {
  return { id, score, url: doc?.url ?? "", fields: doc?.fields ?? {} };
}

/**
 * Runs brute-force cosine similarity (`./vector-search.js`) against the
 * manifest's vector shard for `language`, if one was built
 * (docs/guides/vector-search.md#storage-format) -- a language
 * with no vector shard (e.g. an empty partition, or a corpus built
 * without a `vectors` option at all) simply has no vector matches,
 * mirroring how a language with no term shard returns no lexical
 * matches, rather than being an error.
 */
async function vectorHitsForLanguage(
  manifest: Manifest,
  cache: ShardCache,
  baseUrl: string,
  language: string,
  queryVector: number[],
  limit: number,
): Promise<VectorHit[]> {
  const file = manifest.vectors && ownProp(manifest.vectors.shards, language);
  if (!file) return [];
  const shard = await cache.fetchJson<VectorShard>(resolve(baseUrl, file));
  return bruteForceVectorSearch(queryVector, shard, limit);
}

/** How many candidates each side of a hybrid fusion considers, beyond the caller's own requested `limit` -- RRF/weighted fusion over just the final page size would starve out documents that rank, say, 4th on one side and 4th on the other from ever combining into a top-10 fused result. */
function fusionCandidateLimit(limit: number): number {
  return Math.max(limit * 3, 30);
}

async function vectorOnlySearch(
  manifest: Manifest,
  cache: ShardCache,
  baseUrl: string,
  queryVector: number[],
  options: SearchOptions,
): Promise<SearchResult> {
  const language = options.language ?? manifest.defaultLanguage;
  const limit = options.limit ?? 10;
  const vectorHits = await vectorHitsForLanguage(
    manifest,
    cache,
    baseUrl,
    language,
    queryVector,
    limit,
  );
  const docLookup = await fetchDocStoreEntriesByIds(
    manifest,
    cache,
    baseUrl,
    vectorHits.map((v) => v.docId),
  );
  const hits = vectorHits.map((v) =>
    docStoreEntryToHit(v.docId, v.score, docLookup.get(v.docId)),
  );
  return { hits, totalHits: hits.length, language };
}

/** `(v - min) / (max - min)` over `values`, clamped to a constant `1` when every value is identical (nothing to distinguish, and avoids a divide-by-zero) -- used to bring BM25F scores and cosine similarities onto a comparable `[0, 1]` scale before a weighted combination, since only RRF's rank-based default is calibration-free. */
function minMaxNormalize(values: number[]): (value: number) => number {
  if (values.length === 0) return () => 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return () => 1;
  return (value: number) => (value - min) / (max - min);
}

/**
 * Combines a lexical result (computed with a wider-than-requested limit
 * so fusion has real candidates to work with, per `fusionCandidateLimit`)
 * with an independent vector search over the same query
 * (docs/guides/vector-search.md#hybrid-search-combining-lexical-and-vector-scores).
 * Pinned hits (docs/guides/pinning.md) are carried over
 * unchanged and excluded from fusion entirely -- a pin is an editorial
 * override, not a candidate for a similarity-based reordering -- so only
 * the *organic* lexical hits are fused with the vector hits, then both
 * are re-merged with the untouched pinned hits in front, truncated to
 * the caller's real `options.limit`.
 */
async function fuseHybridResult(
  manifest: Manifest,
  cache: ShardCache,
  baseUrl: string,
  lexicalResult: SearchResult,
  vectorHits: VectorHit[],
  options: SearchOptions,
): Promise<SearchResult> {
  const limit = options.limit ?? 10;
  const pinnedHits = lexicalResult.hits.filter((h) => h.pinned);
  const organicLexicalHits = lexicalResult.hits.filter((h) => !h.pinned);
  const pinnedIds = new Set(pinnedHits.map((h) => h.id));

  const nonPinnedVectorHits = vectorHits.filter((v) => !pinnedIds.has(v.docId));

  let combined: Map<number, number>;
  if (options.vectorWeight !== undefined) {
    const vectorWeight = options.vectorWeight;
    const normalizeLexical = minMaxNormalize(
      organicLexicalHits.map((h) => h.score),
    );
    const normalizeVector = minMaxNormalize(
      nonPinnedVectorHits.map((v) => v.score),
    );
    combined = new Map<number, number>();
    for (const hit of organicLexicalHits) {
      combined.set(
        hit.id,
        (combined.get(hit.id) ?? 0) +
          (1 - vectorWeight) * normalizeLexical(hit.score),
      );
    }
    for (const v of nonPinnedVectorHits) {
      combined.set(
        v.docId,
        (combined.get(v.docId) ?? 0) + vectorWeight * normalizeVector(v.score),
      );
    }
  } else {
    combined = reciprocalRankFusion([
      organicLexicalHits.map((h) => h.id),
      nonPinnedVectorHits.map((v) => v.docId),
    ]);
  }

  const ranked = [...combined.entries()].sort((a, b) => b[1] - a[1]);
  const remainingSlots = Math.max(0, limit - pinnedHits.length);
  const topRanked = ranked.slice(0, remainingSlots);

  const lexicalHitById = new Map(organicLexicalHits.map((h) => [h.id, h]));
  const missingIds = topRanked
    .map(([id]) => id)
    .filter((id) => !lexicalHitById.has(id));
  const extraDocLookup = missingIds.length
    ? await fetchDocStoreEntriesByIds(manifest, cache, baseUrl, missingIds)
    : new Map<number, DocStoreEntry>();

  const hits: Hit[] = [
    ...pinnedHits,
    ...topRanked.map(([id, fusedScore]) => {
      const existing = lexicalHitById.get(id);
      return existing
        ? { ...existing, score: fusedScore }
        : docStoreEntryToHit(id, fusedScore, extraDocLookup.get(id));
    }),
  ];

  const totalHits = new Set([...pinnedIds, ...combined.keys()]).size;

  return {
    hits,
    ...(lexicalResult.facets ? { facets: lexicalResult.facets } : {}),
    totalHits,
    language: lexicalResult.language,
    ...(lexicalResult.didYouMean
      ? { didYouMean: lexicalResult.didYouMean }
      : {}),
  };
}

/**
 * Public entry point dispatching on `options.mode`
 * (docs/guides/vector-search.md#api-surface). `"lexical"`
 * (default) delegates entirely to `lexicalSearch` above, unchanged from
 * before vector search existed. `"vector"`/`"hybrid"` require a
 * `queryVector` — computed by `SearchClient` from its configured
 * `embedQuery` before this function is ever called, since embedding is
 * an arbitrary caller-supplied function that can't cross the Worker
 * postMessage boundary, only its plain-array *result* can. A direct
 * caller of this module (bypassing `SearchClient`) who requests
 * vector/hybrid mode without supplying one gets the same
 * `VectorSearchNotConfiguredError` a misconfigured `SearchClient` would
 * throw, rather than a confusing type error deeper in the call stack.
 */
export async function search(
  query: string,
  manifest: Manifest,
  cache: ShardCache,
  baseUrl: string,
  options: SearchOptions = {},
  queryVector?: number[],
): Promise<SearchResult> {
  const mode = options.mode ?? "lexical";
  if (mode === "lexical") {
    return lexicalSearch(query, manifest, cache, baseUrl, options);
  }
  if (!queryVector) {
    throw new VectorSearchNotConfiguredError(
      `search: mode "${mode}" requires a query embedding, but none was supplied — configure SearchClientOptions.embedQuery (docs/guides/vector-search.md#the-hard-constraint-where-does-the-query-embedding-come-from)`,
    );
  }

  if (mode === "vector") {
    return vectorOnlySearch(manifest, cache, baseUrl, queryVector, options);
  }

  const language = options.language ?? manifest.defaultLanguage;
  const wideLimit = fusionCandidateLimit(options.limit ?? 10);
  const [lexicalResult, vectorHits] = await Promise.all([
    lexicalSearch(query, manifest, cache, baseUrl, {
      ...options,
      limit: wideLimit,
    }),
    vectorHitsForLanguage(
      manifest,
      cache,
      baseUrl,
      language,
      queryVector,
      wideLimit,
    ),
  ]);
  return fuseHybridResult(
    manifest,
    cache,
    baseUrl,
    lexicalResult,
    vectorHits,
    options,
  );
}

/**
 * Streaming/incremental variant of search()
 * (docs/reference/client-api.md#streamingincremental-results): resolves to the
 * exact same final `SearchResult` `search()` would, but -- only when
 * the caller actually opted into `synonyms` and/or `fuzzy` -- first
 * invokes `onPartial` with the fast literal/prefix-only pass (the same
 * clauses `search()` would resolve with both options forced off), so a
 * keystroke-driven UI can render exact matches immediately instead of
 * waiting for the (potentially slower) synonym/fuzzy-expanded pass to
 * land. When neither was requested there is nothing to expand, so only
 * one pass runs and `onPartial` is never invoked -- calling it with a
 * result identical to what the returned promise already resolves to
 * would be a redundant, meaningless event.
 *
 * Implemented by calling `search()` itself up to twice rather than
 * restructuring its clause-scoring loop into a genuinely shared
 * two-phase pass: `ShardCache` already memoizes the term-shard fetches
 * both passes need, so the only repeated work is the (cheap, in-memory,
 * corpus-scale-appropriate per docs/guides/indexing.md)
 * clause/candidate/scoring loop -- negligible next to the correctness
 * risk of threading a partial-emission callback through that loop's
 * single-pass control flow.
 */
export async function searchStream(
  query: string,
  manifest: Manifest,
  cache: ShardCache,
  baseUrl: string,
  options: SearchOptions,
  onPartial?: (partial: SearchResult) => void,
): Promise<SearchResult> {
  if (!options.synonyms && !options.fuzzy) {
    return search(query, manifest, cache, baseUrl, options);
  }
  const partial = await search(query, manifest, cache, baseUrl, {
    ...options,
    synonyms: false,
    fuzzy: false,
  });
  onPartial?.(partial);
  return search(query, manifest, cache, baseUrl, options);
}

export interface FacetValuesOptions {
  /**
   * Same filter shape as SearchOptions.filters. A filter on `field`
   * itself is ignored for narrowing (its `selected` flags are still
   * reported) — matches search()'s options.facets convention: a facet
   * field never filters against its own active selection, so switching
   * between its own values shows real per-value counts rather than the
   * post-filter count for all of them.
   */
  filters?: Record<string, string | string[] | RangeFilter>;
  /** Same cancellation semantics as SearchOptions.signal above. */
  signal?: AbortSignal;
}

/**
 * A filter-only facet panel query with no free-text search
 * (docs/reference/client-api.md#facet-only-queries) — e.g. rendering a
 * category-landing-page sidebar before a visitor has typed anything.
 * Counts are contextual against every *other* active filter, same
 * convention as search()'s options.facets, but the base candidate set
 * here is the whole corpus rather than an organic query's matches
 * (there is none) — when no other filter is active, that base set is
 * "every doc with a value for this field," so the precomputed
 * build-time `entry.count` (docs/guides/facets.md#facet-counts) is
 * used directly instead of re-deriving it from `entry.docs.length`;
 * when another filter *is* active, the count is a live intersection of
 * `entry.docs` against that filter's matching doc-id set, just like
 * search()'s facets. A range-type `field` returns its precomputed
 * aggregate buckets the same way search()'s `facets` option does
 * (docs/guides/facets.md#facet-index-structure); a hierarchy-type
 * `field` returns `separator` alongside `values` the same way
 * search()'s `facets` option does too (see FacetResult).
 */
export async function facetValues(
  field: string,
  manifest: Manifest,
  cache: ShardCache,
  baseUrl: string,
  options: FacetValuesOptions = {},
): Promise<FacetResult> {
  const otherFilterFields = Object.keys(options.filters ?? {}).filter(
    (f) => f !== field,
  );
  const neededFields = [...new Set([field, ...otherFilterFields])];
  const facetShardsByField = await fetchFacetShards(
    manifest,
    cache,
    baseUrl,
    neededFields,
  );

  const shard = facetShardsByField.get(field);
  if (!shard) return { values: [] };

  let baseSet: Set<number> | undefined;
  for (const f of otherFilterFields) {
    if (!facetShardsByField.has(f)) continue;
    const unionSet = unionDocsForField(facetShardsByField, options.filters, f);
    baseSet = baseSet
      ? new Set([...baseSet].filter((id) => unionSet.has(id)))
      : unionSet;
  }

  const selectedValues = new Set(valuesFor(options.filters, field));
  return {
    values: Object.entries(shard.values).map(([value, entry]) => ({
      value,
      count: baseSet
        ? entry.docs.filter((id) => baseSet?.has(id)).length
        : entry.count,
      selected: selectedValues.has(value),
    })),
    ...(shard.type === "hierarchy"
      ? { separator: shard.separator ?? ">" }
      : {}),
  };
}
