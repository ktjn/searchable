import { getLanguageProfile, normalizePhrase } from "@csf/analysis";
import type {
  DocStoreEntry,
  FacetShard,
  FuzzyShard,
  Manifest,
  PinsShard,
  SynonymShard,
  TermEntry,
  TermShard,
} from "@csf/format";
import type { ShardCache } from "./fetch-json.js";
import type { HighlightSpan } from "./highlight.js";
import { highlightText } from "./highlight.js";
import { parseQueryTerms } from "./parse-query.js";
import { scoreTermForDoc } from "./score.js";

export interface Hit {
  id: number;
  score: number;
  url: string;
  fields: Record<string, string>;
  /** Placed by a csf-pin match (docs/16-term-to-page-pinning.md), not by relevance. */
  pinned?: boolean;
  /**
   * Per stored field, that field's text split into match/non-match
   * spans for the literal query terms typed (docs/08-modern-features.md#highlighting--snippets).
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
}

/** Inclusive bounds for a range-facet filter (docs/06-faceted-search.md#filtering). Omit either end for an open-ended range. */
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
   * Nearest real term(s) in the corpus for a query term that failed to
   * match at all, byproduct of the fuzzy dictionary
   * (docs/04-query-ranking-boosts.md#did-you-mean--query-suggestions).
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
     * contribution (docs/04-query-ranking-boosts.md#boost-types-summarized).
     * Keyed by the term as it appears *after* analysis (lowercased,
     * stemmed, etc.) — the same form stored in the term shard — not the
     * raw surface form the user typed.
     */
    terms?: Record<string, number>;
  };
  /**
   * Facet filters (docs/06-faceted-search.md#filtering): a string or
   * string[] for a terms facet (OR across an array of values within
   * one field, AND across different fields); a `{min?, max?}` range
   * for a range facet (docs/06-faceted-search.md#facet-index-structure) —
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
   * (docs/05-synonyms.md). Off by default — a caller opts in per query,
   * matching this option's original design in docs/07-client-api.md.
   * Prefix clauses (`term*`) are not synonym-expanded; combining the two
   * expansion mechanisms for one query slot isn't specified anywhere,
   * so this scopes them as independent.
   */
  synonyms?: boolean;
  /**
   * Score multiplier applied to a hit's contribution *only* when it
   * came from a synonym-expanded variant, not the literal query term
   * (docs/05-synonyms.md#scoring-impact) — a document containing the
   * literal term still outranks one that only matches via synonym
   * expansion, all else equal. Only meaningful when `synonyms: true`.
   */
  synonymWeight?: number;
  /**
   * Expand each non-prefix query term into typo-tolerant matches from
   * the manifest's fuzzy (SymSpell deletion dictionary) shard for the
   * resolved language, if one exists
   * (docs/04-query-ranking-boosts.md#prefix--fuzzy-matching). Off by
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
   * (docs/08-modern-features.md#highlighting--snippets). Off by
   * default, matching every other opt-in query feature here — most
   * callers building a list UI want this, but it's extra work per hit
   * that a caller only rendering, say, a "did you mean" prompt doesn't
   * need to pay for.
   */
  highlight?: boolean;
  /**
   * Reject the in-flight `SearchClient.search()` call as soon as this
   * signal aborts (docs/08-modern-features.md#instant-search--debouncing--cancellation)
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
}

/** docs/05-synonyms.md#scoring-impact. */
const DEFAULT_SYNONYM_WEIGHT = 0.5;
/** docs/04-query-ranking-boosts.md#prefix--fuzzy-matching. */
const DEFAULT_FUZZY_WEIGHT = 0.5;
/** How many "did you mean" suggestions to surface per unmatched query term. */
const MAX_SUGGESTIONS_PER_TERM = 3;

function resolve(baseUrl: string, relPath: string): string {
  return new URL(relPath, baseUrl).toString();
}

/** Whether `phraseTokens` appears as a contiguous run inside `queryTokens` (docs/16-term-to-page-pinning.md#authoring, contains mode). */
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
    // scale (docs/14-reference-deployment-cms-2k.md#what-to-simplify-at-this-scale).
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

/** Every other term `term` expands to via the synonym shard's equivalence classes and directional map (docs/05-synonyms.md). */
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
  for (const variant of synonymShard.directional?.[term] ?? []) {
    variants.add(variant);
  }
  return [...variants];
}

/**
 * Unique strings reachable by deleting exactly one Unicode code point
 * from `term` (plus `term` itself, 0 deletions) — the query-side half
 * of the SymSpell candidate lookup. Deliberately duplicated from the
 * indexer's identical helper (build-index.ts) rather than shared:
 * it's a ~6-line pure function with exactly two callers across two
 * packages that must never share a runtime dependency (the browser
 * bundle can't pull in indexer code), the same reasoning already
 * applied to the e2e-browser serve-dir.ts duplication.
 */
function generateDeletes(term: string): string[] {
  const chars = [...term];
  const variants = new Set<string>([term]);
  for (let i = 0; i < chars.length; i++) {
    variants.add(chars.slice(0, i).join("") + chars.slice(i + 1).join(""));
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
 * Every real term discoverable from `term` via the deletion dictionary
 * (a fast candidate generator, not a distance oracle), each paired with
 * its true Levenshtein distance from `term`. Excludes `term` itself
 * (distance 0 — that's an exact match, not a fuzzy one). Deliberately
 * unfiltered by `fuzzyShard.maxEdits`: the symmetric-delete lookup can
 * surface true-distance-2 candidates too (e.g. an adjacent-character
 * transposition, where query and real term each delete a different
 * character and land on the same shorter string) even though the
 * dictionary was only built to guarantee distance-1 coverage. Callers
 * decide how strict to be.
 */
function fuzzyCandidatesFor(
  term: string,
  fuzzyShard: FuzzyShard | undefined,
): { term: string; distance: number }[] {
  if (!fuzzyShard) return [];
  const candidates = new Set<string>();
  for (const t of fuzzyShard.deletions[term] ?? []) candidates.add(t);
  for (const deletion of generateDeletes(term)) {
    for (const t of fuzzyShard.deletions[deletion] ?? []) candidates.add(t);
  }
  const matches: { term: string; distance: number }[] = [];
  for (const candidate of candidates) {
    if (candidate === term) continue;
    matches.push({
      term: candidate,
      distance: levenshteinDistance(term, candidate),
    });
  }
  return matches;
}

/**
 * Real terms within `fuzzyShard.maxEdits` of `term` — the strict subset
 * of `fuzzyCandidatesFor` used for query expansion (docs/04-query-ranking-boosts.md#prefix--fuzzy-matching).
 */
function fuzzyMatchesFor(
  term: string,
  fuzzyShard: FuzzyShard | undefined,
): { term: string; distance: number }[] {
  if (!fuzzyShard) return [];
  return fuzzyCandidatesFor(term, fuzzyShard).filter(
    (match) => match.distance <= fuzzyShard.maxEdits,
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
  fuzzyShard: FuzzyShard | undefined,
  limit: number,
): string[] {
  return fuzzyCandidatesFor(term, fuzzyShard)
    .sort((a, b) => a.distance - b.distance || a.term.localeCompare(b.term))
    .slice(0, limit)
    .map((match) => match.term);
}

/**
 * Boolean-AND query evaluation over the shards a query actually needs
 * (docs/01-architecture.md#data-flow-for-a-query): analyze the query
 * with the same LanguageProfile the indexer used, fetch only the term
 * shard(s) covering the matched language, intersect posting doc-id
 * sets across every query term, score the intersection with BM25F, and
 * fetch doc-store data for only the final top-N hits. Facet filters
 * narrow the candidate set before scoring; pins are resolved
 * independently of the organic query and spliced onto the front of the
 * result (docs/16-term-to-page-pinning.md).
 */
export async function search(
  query: string,
  manifest: Manifest,
  cache: ShardCache,
  baseUrl: string,
  options: SearchOptions = {},
): Promise<SearchResult> {
  const language = options.language ?? manifest.defaultLanguage;
  const profile = getLanguageProfile(language);

  const queryTerms = parseQueryTerms(query, profile);
  if (queryTerms.length === 0) return { hits: [], totalHits: 0 };

  const shardEntries = manifest.shards.terms.filter((s) => s.lang === language);
  const shards = await Promise.all(
    shardEntries.map((entry) =>
      cache.fetchJson<TermShard>(resolve(baseUrl, entry.file)),
    ),
  );

  const termLookup = new Map<string, TermEntry>();
  for (const shard of shards) {
    for (const [term, entry] of Object.entries(shard)) {
      termLookup.set(term, entry);
    }
  }

  // Fetched up front (not lazily inside the clause loop below) because
  // every non-prefix clause needs it to resolve variants before the
  // organic-match/no-match decision is made for that clause.
  const synonymsFile = options.synonyms
    ? manifest.synonyms?.[language]
    : undefined;
  const synonymShard = synonymsFile
    ? await cache.fetchJson<SynonymShard>(resolve(baseUrl, synonymsFile))
    : undefined;
  const synonymWeight = options.synonymWeight ?? DEFAULT_SYNONYM_WEIGHT;

  const fuzzyFile = options.fuzzy ? manifest.fuzzy?.[language] : undefined;
  const fuzzyShard = fuzzyFile
    ? await cache.fetchJson<FuzzyShard>(resolve(baseUrl, fuzzyFile))
    : undefined;
  const fuzzyWeight = options.fuzzyWeight ?? DEFAULT_FUZZY_WEIGHT;

  // Each query term becomes a clause: an exact term matches at most one
  // TermEntry (plus, when synonyms/fuzzy are enabled, any equivalence/
  // directional variant or typo-tolerant match that also has a
  // dictionary entry, each scored at a reduced weight relative to the
  // literal term), a prefix (`term*`) matches every real term starting
  // with it — resolved here by scanning the already-fetched shard's
  // term dictionary (a contiguous range scan over a sorted structure at
  // larger scale, per docs/02-index-format.md#size-targets--sharding-tuning,
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
      for (const match of fuzzyMatchesFor(qt.term, fuzzyShard)) {
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
  const organicMatched = !anyClauseFailed;

  let organicCandidateIds: number[] = [];
  if (organicMatched) {
    const docIdSets = clauses.map((clause) => {
      const ids = new Set<number>();
      for (const { entry } of clause.entries) {
        for (const posting of entry.postings) ids.add(posting.doc);
      }
      return ids;
    });
    const [first, ...rest] = docIdSets;
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

  // --- pins (docs/16-term-to-page-pinning.md), resolved independently
  // of whether the organic query matched anything ---
  const normalizedQuery = normalizePhrase(query, profile);
  const pinsFile = manifest.pins?.[language];
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
    // author's pin (docs/16#authoring, "interaction with active facet filters").
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
  // (docs/16#what-happens-at-query-time) — pinned hits are the whole result.
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
  const docShardEntries = manifest.shards.docs.filter((d) =>
    allResultIds.some((id) => id >= d.idRange[0] && id <= d.idRange[1]),
  );
  const docShards = await Promise.all(
    docShardEntries.map((entry) =>
      cache.fetchJson<Record<string, DocStoreEntry>>(
        resolve(baseUrl, entry.file),
      ),
    ),
  );
  const docLookup = new Map<number, DocStoreEntry>();
  for (const shard of docShards) {
    for (const [id, entry] of Object.entries(shard)) {
      docLookup.set(Number(id), entry);
    }
  }

  function toHit(id: number, score: number, pinned: boolean): Hit {
    const doc = docLookup.get(id);
    const fields = doc?.fields ?? {};
    const highlights = options.highlight
      ? Object.fromEntries(
          Object.entries(fields).map(([field, text]) => [
            field,
            highlightText(text, queryTerms),
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
      };
    }
  }

  // --- "did you mean" (docs/04-query-ranking-boosts.md#did-you-mean--query-suggestions):
  // a byproduct of the fuzzy dictionary, only computed when the caller
  // opted into fuzzy matching and the query still returned nothing ---
  let didYouMean: string[] | undefined;
  if (
    options.fuzzy &&
    fuzzyShard &&
    hits.length === 0 &&
    failedTerms.length > 0
  ) {
    const suggestions = new Set<string>();
    for (const term of failedTerms) {
      for (const candidate of nearestTermsFor(
        term,
        fuzzyShard,
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
    ...(didYouMean ? { didYouMean } : {}),
  };
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
 * (docs/07-client-api.md#facet-only-queries) — e.g. rendering a
 * category-landing-page sidebar before a visitor has typed anything.
 * Counts are contextual against every *other* active filter, same
 * convention as search()'s options.facets, but the base candidate set
 * here is the whole corpus rather than an organic query's matches
 * (there is none) — when no other filter is active, that base set is
 * "every doc with a value for this field," so the precomputed
 * build-time `entry.count` (docs/06-faceted-search.md#facet-counts) is
 * used directly instead of re-deriving it from `entry.docs.length`;
 * when another filter *is* active, the count is a live intersection of
 * `entry.docs` against that filter's matching doc-id set, just like
 * search()'s facets. A range-type `field` naturally returns an empty
 * `values` array (`shard.values` is always `{}` for range facets today)
 * — aggregate range-facet histogram results remain unimplemented
 * (docs/09-roadmap.md), the same scoping already applied to search()'s
 * `facets` option for a range field.
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
  };
}
