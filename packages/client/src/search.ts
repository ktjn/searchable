import { getLanguageProfile, normalizePhrase } from "@csf/analysis";
import type {
  DocStoreEntry,
  FacetShard,
  Manifest,
  PinsShard,
  TermEntry,
  TermShard,
} from "@csf/format";
import type { ShardCache } from "./fetch-json.js";
import { parseQueryTerms } from "./parse-query.js";
import { scoreTermForDoc } from "./score.js";

export interface Hit {
  id: number;
  score: number;
  url: string;
  fields: Record<string, string>;
  /** Placed by a csf-pin match (docs/16-term-to-page-pinning.md), not by relevance. */
  pinned?: boolean;
}

export interface FacetResultValue {
  value: string;
  count: number;
  selected: boolean;
}

export interface FacetResult {
  values: FacetResultValue[];
}

export interface SearchResult {
  hits: Hit[];
  /** Only present for facet fields the caller asked to include via options.facets. */
  facets?: Record<string, FacetResult>;
  totalHits: number;
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
   * Terms-only facet filters (docs/06-faceted-search.md#filtering):
   * OR across an array of values within one field, AND across
   * different fields. A field with no matching facet shard in the
   * manifest is ignored rather than zeroing out the whole query — a
   * typo'd/unknown filter field is a build-time linting concern
   * elsewhere, not something a single query should hard-fail on.
   */
  filters?: Record<string, string | string[]>;
  /**
   * Facet fields to compute contextual counts for and include in
   * `SearchResult.facets`. Counts are computed against the candidate
   * set with every *other* active filter applied but not this field's
   * own — the standard "how many if I also pick X" faceted-search
   * convention — so switching between values of the same facet shows
   * meaningful counts instead of the post-filter count for all of them.
   */
  facets?: string[];
}

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

function valuesFor(
  filters: Record<string, string | string[]> | undefined,
  field: string,
): string[] {
  const raw = filters?.[field];
  if (raw === undefined) return [];
  return Array.isArray(raw) ? raw : [raw];
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

  // Each query term becomes a clause: an exact term matches at most one
  // TermEntry, a prefix (`term*`) matches every real term starting with
  // it — resolved here by scanning the already-fetched shard's term
  // dictionary (a contiguous range scan over a sorted structure at
  // larger scale, per docs/02-index-format.md#size-targets--sharding-tuning,
  // but a plain filter is exact and sufficient at this corpus size).
  // A clause with zero matches fails the organic query (boolean AND) —
  // but not pin matching, which runs independently below.
  const clauses: { term: string; entries: TermEntry[] }[] = [];
  let organicMatched = true;
  for (const qt of queryTerms) {
    const entries = qt.prefix
      ? [...termLookup.entries()]
          .filter(([term]) => term.startsWith(qt.term))
          .map(([, entry]) => entry)
      : [termLookup.get(qt.term)].filter(
          (e): e is TermEntry => e !== undefined,
        );
    if (entries.length === 0) {
      organicMatched = false;
      break;
    }
    clauses.push({ term: qt.term, entries });
  }

  let organicCandidateIds: number[] = [];
  if (organicMatched) {
    const docIdSets = clauses.map((clause) => {
      const ids = new Set<number>();
      for (const entry of clause.entries) {
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
  const neededFields = [
    ...new Set([...filterFields, ...requestedFacetFields]),
  ].filter((f) => manifest.shards.facets?.some((s) => s.field === f));
  const facetShardFileEntries = (manifest.shards.facets ?? []).filter((s) =>
    neededFields.includes(s.field),
  );
  const fetchedFacetShards = await Promise.all(
    facetShardFileEntries.map(
      async (entry) =>
        [
          entry.field,
          await cache.fetchJson<FacetShard>(resolve(baseUrl, entry.file)),
        ] as const,
    ),
  );
  const facetShardsByField = new Map(fetchedFacetShards);

  function unionDocsForField(field: string): Set<number> {
    const shard = facetShardsByField.get(field);
    const ids = new Set<number>();
    if (!shard) return ids;
    for (const value of valuesFor(options.filters, field)) {
      for (const id of shard.values[value]?.docs ?? []) ids.add(id);
    }
    return ids;
  }

  const activeFilterFields = filterFields.filter((f) =>
    facetShardsByField.has(f),
  );
  const filterUnionSets = new Map(
    activeFilterFields.map((f) => [f, unionDocsForField(f)]),
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
    for (const entry of clause.entries) {
      for (const posting of entry.postings) {
        if (!candidateSet.has(posting.doc)) continue;
        const s =
          scoreTermForDoc(
            posting,
            entry.df,
            manifest,
            language,
            options.boosts?.fields,
          ) * termBoost;
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
    return {
      id,
      score,
      url: doc?.url ?? "",
      fields: doc?.fields ?? {},
      ...(pinned ? { pinned: true } : {}),
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
      facets[field] = {
        values: Object.entries(shard.values).map(([value, entry]) => ({
          value,
          count: entry.docs.filter((id) => baseSet.has(id)).length,
          selected: selectedValues.has(value),
        })),
      };
    }
  }

  return { hits, ...(facets ? { facets } : {}), totalHits };
}
