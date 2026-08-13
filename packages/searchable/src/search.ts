import {
  getLanguageProfile,
  normalizePhrase,
  ownProp,
} from "./analysis/index.js";
import { fetchDocStoreEntriesByIds } from "./doc-store.js";
import { fetchFacetShards, unionDocsForField, valuesFor } from "./facets.js";
import type { ShardCache } from "./fetch-json.js";
import type {
  Manifest,
  PinsShard,
  SynonymShard,
  TermEntry,
  TermShard,
} from "./format/index.js";
import { fuzzyMatchesFor, loadFuzzyLookup, nearestTermsFor } from "./fuzzy.js";
import type { HighlightSpan, HighlightTerm } from "./highlight.js";
import { highlightText } from "./highlight.js";
import { parseQuery } from "./parse-query.js";
import { containsPhrase, hasConsecutivePositions } from "./phrase.js";
import { scoreTermForDoc } from "./score.js";
import { multiWordVariantsFor, synonymVariantsFor } from "./synonyms.js";
import { resolve } from "./url.js";

export interface Hit {
  id: number;
  score: number;
  url: string;
  fields: Record<string, string>;
  /** Placed by a searchable-pin match (docs/guides/pinning.md), not by relevance. */
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
   * consumer combine it with `@ktjn/searchable-analysis`'s `isRtlLanguage()`
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
   * Logical operator to use when combining multiple query term slots:
   * `"and"` (default) requires every term slot to match the same
   * document; `"or"` returns documents matching any term slot, ranked
   * by the total score across all matches.
   */
  operator?: "and" | "or";
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
}

/** docs/guides/synonyms.md#scoring-impact. */
const DEFAULT_SYNONYM_WEIGHT = 0.5;
/** docs/guides/ranking-and-boosts.md#prefix-and-fuzzy-matching. */
const DEFAULT_FUZZY_WEIGHT = 0.5;
/** How many "did you mean" suggestions to surface per unmatched query term. */
const MAX_SUGGESTIONS_PER_TERM = 3;

/**
 * `"all"` is a reserved shard-prefix value (docs/concepts/index-format.md#term-shard-inverted-index)
 * meaning "this shard holds the entire vocabulary for its language,"
 * not a literal character prefix -- unlike every other prefix value,
 * which *is* a real leading substring of every term inside it. Emitted
 * by `write_index(built, outDir, shard_by_prefix=False)`
 * (docs/guides/indexing.md's small-corpus mode) and by
 * the independent reference generator (spec/examples/python/), so any
 * conformant producer's output can use it, not just this project's own
 * indexer.
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
 * with total vocabulary size.
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
  const operator = options.operator ?? "and";

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
      const shard = await cache.fetchJson<TermShard>(
        resolve(baseUrl, entry.file),
      );
      for (const [term, e] of Object.entries(shard)) {
        termLookup.set(term, e);
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

    if (totalMatchedDocs.size === 0) {
      if (operator === "and") anyClauseFailed = true;
    }
    phraseMatchedDocSets.push(totalMatchedDocs);
  }

  const organicMatched = operator === "or" || !anyClauseFailed;

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
    if (allDocSets.length > 0) {
      if (operator === "or") {
        const union = new Set<number>();
        for (const set of allDocSets) {
          for (const id of set) union.add(id);
        }
        organicCandidateIds = [...union];
      } else {
        const [first, ...rest] = allDocSets;
        organicCandidateIds = [...(first ?? [])].filter((id) =>
          rest.every((set) => set.has(id)),
        );
      }
    }
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
      // @ktjn/searchable-format) -- this naturally produces an empty `values`
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

export async function search(
  query: string,
  manifest: Manifest,
  cache: ShardCache,
  baseUrl: string,
  options: SearchOptions = {},
): Promise<SearchResult> {
  return lexicalSearch(query, manifest, cache, baseUrl, options);
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
