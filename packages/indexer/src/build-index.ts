import {
  analyze,
  getLanguageProfile,
  getOrCreate,
  normalizePhrase,
  ownProp,
} from "@csf/analysis";
import { extractDocument } from "./extract.js";
import type {
  BuiltIndex,
  DocStoreShard,
  FacetShard,
  FuzzyShard,
  PinsShard,
  Posting,
  SourceDocument,
  SynonymShard,
  TermEntry,
  TermShard,
} from "./types.js";

const EXCERPT_LENGTH = 200;

interface FieldBoosts {
  title: number;
  body: number;
}

/** Realistic defaults matching the example in docs/04-query-ranking-boosts.md. */
const DEFAULT_FIELD_BOOSTS: FieldBoosts = { title: 3.0, body: 1.0 };

export interface BuildIndexOptions {
  /** Per-field boost overrides, merged over DEFAULT_FIELD_BOOSTS. */
  fieldBoosts?: Partial<FieldBoosts>;
  /**
   * Author-supplied synonym data, keyed by language — unlike facets/
   * pins, synonyms are corpus-vocabulary curation, not per-page
   * metadata, so there's no csf-* meta tag for this
   * (docs/05-synonyms.md). Entries are single words/phrases as authored
   * (surface form or already-stemmed, either works); buildIndex
   * normalizes each one through that language's analysis pipeline so
   * lookups at query time match however the term is actually stored.
   * `multiWord` entries are whole phrases (e.g. `["new york", "nyc",
   * "big apple"]`) rather than single words -- each phrase is
   * normalized as a unit (space-joined analyzed terms, matching
   * `normalizePhrase()`'s shape) so it can be matched against a
   * `"quoted phrase"` query clause's own real position-adjacency
   * verification, not a text-substitution shortcut.
   */
  synonyms?: Record<
    string,
    Pick<SynonymShard, "equivalences" | "directional" | "multiWord">
  >;
  /**
   * Build a SymSpell-style deletion dictionary (docs/04-query-ranking-boosts.md#prefix--fuzzy-matching)
   * from each language's own indexed term vocabulary, enabling
   * typo-tolerant fuzzy matching at query time. Off by default: the
   * dictionary adds real index size (roughly proportional to total
   * term length across the vocabulary) that not every deployment wants
   * to pay for.
   */
  fuzzy?: boolean;
  /**
   * How many deletions deep the SymSpell dictionary goes: 1 (default)
   * generates only single-code-point-deletion variants, guaranteeing
   * distance-1 typo coverage; 2 additionally generates every
   * deletion-of-a-deletion variant, guaranteeing real distance-2
   * coverage too (not just the distance-1 dictionary's *occasional*
   * distance-2 hits via symmetric-delete coincidences, e.g. an
   * adjacent-character transposition — see
   * `packages/client/src/search.ts`'s `fuzzyCandidatesFor()`). Doubles
   * or more the dictionary's size for a typical vocabulary, so it's an
   * explicit opt-in, not the default, even when `fuzzy: true`. Only
   * meaningful when `fuzzy: true`; ignored otherwise.
   */
  fuzzyMaxEdits?: 1 | 2;
  /**
   * Facet fields to build as hierarchical (docs/06-faceted-search.md#facet-types),
   * keyed by field name. A build-time decision, not a per-page csf-*
   * meta tag, like fieldBoosts/synonyms/fuzzy above — hierarchy-vs-terms
   * is a corpus-wide schema property of a field, not something one page
   * declares for itself. Each `csf-facet-<field>` value for a
   * hierarchical field is still authored as a single string, but read as
   * a full path (e.g. `"electronics>audio>headphones"`, split on that
   * field's `separator`, default `">"`) rather than an opaque leaf
   * value.
   */
  hierarchicalFacets?: Record<string, { separator?: string }>;
  /**
   * Per-field override of a range facet's histogram results
   * (docs/06-faceted-search.md#facet-index-structure), for any range
   * field not listed here defaulting to `RANGE_FACET_BUCKET_COUNT` (5)
   * equal-width buckets. Two shapes:
   *  - a `number`: that many equal-width buckets spanning the corpus's
   *    observed `[min, max]` (must be a positive integer) — the same
   *    behavior as the default, just a different count.
   *  - a `number[]`: explicit ascending cut points, independent of the
   *    observed data range, for fixed real-world brackets an equal-width
   *    split would never land on (e.g. `[25, 50, 100, 250]` for pricing
   *    tiers "under $25" / "$25-50" / "$50-100" / "$100-250" /
   *    "$250+") — must have at least one boundary, strictly ascending,
   *    all finite.
   * Only affects aggregate *results* (`FacetShard.values`) — range
   * *filtering* (the sorted-array scan) is bucket-shape-independent and
   * unaffected either way. An invalid count or boundary array throws at
   * build time rather than silently producing a nonsensical histogram.
   */
  rangeFacetBuckets?: Record<string, number | number[]>;
  /**
   * Restricts an absolute `<link rel="canonical">` href to one of these
   * exact origins (docs/15-cms-meta-tag-control.md#canonical-url) —
   * anything else falls back to the document's own crawled `url`, same
   * as a missing/invalid canonical tag. `javascript:`/`data:`/other
   * non-web schemes are always rejected regardless of this option
   * (that check isn't optional).
   */
  allowedUrlOrigins?: string[];
  /**
   * Base URL used to resolve a root-relative or relative canonical href
   * into an absolute URL before the protocol/origin checks above run —
   * see `CanonicalUrlOptions.baseUrl` (extract.ts) for exactly what this
   * does and doesn't affect.
   */
  canonicalBaseUrl?: string;
}

const DEFAULT_HIERARCHY_SEPARATOR = ">";

/**
 * Expands a hierarchical facet value into every ancestor path plus
 * itself, e.g. `"a>b>c"` -> `["a", "a>b", "a>b>c"]` — so each level is
 * its own addressable terms-shaped entry in `FacetShard.values`
 * (docs/06-faceted-search.md#facet-index-structure), and a client can
 * filter/count at any depth via a direct lookup rather than a runtime
 * tree-walk. A value with no separator in it (a bare top-level path
 * segment) expands to just itself.
 */
function expandHierarchyPaths(fullPath: string, separator: string): string[] {
  const segments = fullPath
    .split(separator)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return [fullPath];
  const paths: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    paths.push(segments.slice(0, i + 1).join(separator));
  }
  return paths;
}

/**
 * Every string reachable by deleting up to `maxEdits` Unicode code
 * points from `term` (plus `term` itself, 0 deletions) — a breadth-
 * first expansion, one deletion-level at a time, so `maxEdits: 2` also
 * includes every deletion-of-a-deletion, not just direct 2-character
 * removals. Going a level deeper is what lets a *genuine* distance-2
 * typo be found (docs/04-query-ranking-boosts.md#prefix--fuzzy-matching)
 * rather than only the distance-1 dictionary's occasional distance-2
 * hits via symmetric-delete coincidences (e.g. an adjacent-character
 * transposition).
 */
function generateDeletes(term: string, maxEdits: 1 | 2): string[] {
  let frontier = new Set<string>([term]);
  const all = new Set<string>(frontier);
  for (let depth = 0; depth < maxEdits; depth++) {
    const next = new Set<string>();
    for (const variant of frontier) {
      const chars = [...variant];
      for (let i = 0; i < chars.length; i++) {
        next.add(chars.slice(0, i).join("") + chars.slice(i + 1).join(""));
      }
    }
    for (const v of next) all.add(v);
    frontier = next;
  }
  return [...all];
}

/**
 * Builds a SymSpell deletion dictionary from a language's term-shard
 * vocabulary: every deletion-variant (up to `maxEdits` deletions deep)
 * of every real term maps back to the term(s) that produced it. This
 * is purely derived from what's already indexed (unlike synonyms/pins,
 * there's nothing to author) — it's regenerated fresh from
 * `termShard`'s own keys. Guaranteeing distance-2 coverage (as opposed
 * to the distance-1 dictionary's occasional lucky distance-2 hits)
 * requires the *query* side to also generate depth-2 deletions at
 * lookup time — see `packages/client/src/search.ts`'s
 * `fuzzyCandidatesFor()`, which reads `maxEdits` back off this shard
 * rather than assuming depth-1.
 */
function buildFuzzyShard(termShard: TermShard, maxEdits: 1 | 2): FuzzyShard {
  const deletionSets: Record<string, Set<string>> = {};
  for (const term of Object.keys(termShard)) {
    for (const variant of generateDeletes(term, maxEdits)) {
      getOrCreate(deletionSets, variant, () => new Set()).add(term);
    }
  }
  const deletions: Record<string, string[]> = {};
  for (const [variant, terms] of Object.entries(deletionSets)) {
    deletions[variant] = [...terms].sort();
  }
  return { maxEdits, deletions };
}

/**
 * Normalizes author-supplied synonym data through each language's own
 * analysis pipeline (the same normalizePhrase() pins already use), so
 * a synonym entry authored as a surface form ("Couch") matches however
 * @csf/analysis actually stores that term, not the raw authored string.
 * Empty/blank entries (e.g. a term that stems to nothing) and
 * single-member equivalence groups (nothing left to expand to) are
 * dropped rather than carried into the shard as dead weight.
 */
function buildSynonymShards(
  rawSynonyms: BuildIndexOptions["synonyms"],
): Record<string, SynonymShard> {
  const synonymShards: Record<string, SynonymShard> = {};
  if (!rawSynonyms) return synonymShards;

  for (const [language, source] of Object.entries(rawSynonyms)) {
    const profile = getLanguageProfile(language);
    const normalize = (term: string) => normalizePhrase(term, profile);

    const equivalences = (source.equivalences ?? [])
      .map((group) => [...new Set(group.map(normalize).filter(Boolean))])
      .filter((group) => group.length >= 2);

    const directional: Record<string, string[]> = {};
    for (const [key, targets] of Object.entries(source.directional ?? {})) {
      const normalizedKey = normalize(key);
      if (!normalizedKey) continue;
      const normalizedTargets = [
        ...new Set(targets.map(normalize).filter(Boolean)),
      ];
      if (normalizedTargets.length === 0) continue;
      directional[normalizedKey] = normalizedTargets;
    }

    // Each phrase is normalized as a whole unit via the same
    // normalizePhrase() call equivalences/directional use above --
    // it already space-joins every analyzed token in the phrase, so
    // "New York" and "new york" both normalize identically, matching
    // the exact string a query-time "quoted phrase" clause computes
    // from its own analyzed words (packages/client/src/search.ts).
    const multiWord = (source.multiWord ?? [])
      .map((group) => [...new Set(group.map(normalize).filter(Boolean))])
      .filter((group) => group.length >= 2);

    const shard: SynonymShard = {};
    if (equivalences.length) shard.equivalences = equivalences;
    if (Object.keys(directional).length) shard.directional = directional;
    if (multiWord.length) shard.multiWord = multiWord;
    synonymShards[language] = shard;
  }

  return synonymShards;
}

/**
 * source.id ends up denormalized into postings, the doc store, facet
 * value doc-id lists, pin doc lists, and idRange — a duplicate silently
 * merges two unrelated documents' postings and overwrites one's doc
 * store entry; a non-integer or negative id corrupts the idRange
 * min/max math used to pick doc-store shards at query time
 * (REVIEW.md#7). Both are content/authoring bugs worth failing the
 * build over, not something to silently tolerate.
 */
function validateSourceIds(sources: SourceDocument[]): void {
  const seen = new Set<number>();
  for (const source of sources) {
    if (!Number.isInteger(source.id) || source.id < 0) {
      throw new Error(
        `buildIndex: invalid document id ${JSON.stringify(source.id)} for "${source.url}" — ids must be non-negative integers`,
      );
    }
    if (seen.has(source.id)) {
      throw new Error(
        `buildIndex: duplicate document id ${source.id} (seen again at "${source.url}") — every source document must have a unique id`,
      );
    }
    seen.add(source.id);
  }
}

function deriveExcerpt(body: string): string {
  return body.length <= EXCERPT_LENGTH
    ? body
    : `${body.slice(0, EXCERPT_LENGTH).trimEnd()}…`;
}

function addFacetValues(
  facetShards: Record<string, FacetShard>,
  facets: Record<string, string[]>,
  docId: number,
  hierarchicalFacets: Record<string, { separator?: string }>,
): void {
  for (const [field, values] of Object.entries(facets)) {
    const hierarchyConfig = ownProp(hierarchicalFacets, field);
    let shard = Object.hasOwn(facetShards, field)
      ? facetShards[field]
      : undefined;
    if (!shard) {
      shard = hierarchyConfig
        ? {
            type: "hierarchy",
            separator: hierarchyConfig.separator ?? DEFAULT_HIERARCHY_SEPARATOR,
            values: {},
          }
        : { type: "terms", values: {} };
      facetShards[field] = shard;
    } else if (shard.type !== "terms" && shard.type !== "hierarchy") {
      continue; // same field also declared as a range facet elsewhere -- first declaration wins
    }
    // A doc's own distinct values can still overlap at an ancestor
    // level once expanded (e.g. "a>b" and "a>c" both expand through
    // "a") -- union into a Set first so that shared ancestor is only
    // counted once for this document, not once per value that produced
    // it.
    const paths = new Set<string>();
    for (const value of values) {
      if (shard.type === "hierarchy") {
        for (const path of expandHierarchyPaths(
          value,
          shard.separator ?? DEFAULT_HIERARCHY_SEPARATOR,
        )) {
          paths.add(path);
        }
      } else {
        paths.add(value);
      }
    }
    for (const path of paths) {
      const entry = getOrCreate(shard.values, path, () => ({
        count: 0,
        docs: [],
      }));
      entry.docs.push(docId);
      entry.count++;
    }
  }
}

/**
 * Range facets (docs/06-faceted-search.md#facet-index-structure) store
 * every (value, doc) pair -- an arbitrary min/max *filter* is resolved
 * directly against this sorted array (sorted once, after every
 * document is processed) rather than being limited to precomputed
 * bucket boundaries. `values` is populated separately, after all docs
 * are processed, by `computeRangeFacetBucketsEqualWidth()`/
 * `computeRangeFacetBucketsExplicit()` below -- aggregate
 * *results* (the display-side histogram/bucket breakdown) and
 * filtering are two independent capabilities on the same shard.
 */
function addRangeFacetValues(
  facetShards: Record<string, FacetShard>,
  rangeFacets: Record<string, number>,
  docId: number,
): void {
  for (const [field, value] of Object.entries(rangeFacets)) {
    let shard = Object.hasOwn(facetShards, field)
      ? facetShards[field]
      : undefined;
    if (!shard) {
      shard = { type: "range", values: {}, sorted: [] };
      facetShards[field] = shard;
    } else if (shard.type !== "range") {
      continue; // same field also declared as a terms facet elsewhere -- first declaration wins
    }
    shard.sorted?.push({ value, doc: docId });
  }
}

/** Default number of equal-width buckets computed for a range facet's aggregate results (docs/06-faceted-search.md#facet-index-structure), for any field not given its own count via BuildIndexOptions.rangeFacetBuckets. */
const RANGE_FACET_BUCKET_COUNT = 5;

/** Formats a bucket boundary without a trailing ".00" for whole numbers. */
function formatBucketBound(n: number): string {
  return Number(n.toFixed(2)).toString();
}

/** Adds `doc` to `shard.values[label]`, creating the entry on first use — shared by both bucket-computation strategies below. */
function addToBucket(shard: FacetShard, label: string, doc: number): void {
  let entry = shard.values[label];
  if (!entry) {
    entry = { count: 0, docs: [] };
    shard.values[label] = entry;
  }
  entry.docs.push(doc);
  entry.count++;
}

/**
 * Populates a range facet shard's `values` with equal-width aggregate
 * buckets computed over the corpus's full observed [min, max] --
 * docs/06-faceted-search.md#facet-index-structure's aggregate range
 * *results*, as opposed to filtering (which resolves directly against
 * `sorted` and doesn't need buckets at all). Reuses the exact same
 * `FacetValueEntry` shape (`{count, docs}`) terms facets use, keyed by
 * a human-readable bucket label (`"10-20"`, or `"40+"` for the
 * open-ended last bucket) -- deliberately so: the client's existing
 * contextual-count aggregation (`packages/client/src/search.ts`'s
 * `search()`/`facetValues()`) already iterates `shard.values`
 * generically regardless of facet type, so populating this object here
 * is the *entire* implementation of aggregate range results -- no
 * client-side changes are needed at all. Must run after `shard.sorted`
 * is fully populated and sorted (every document processed).
 */
function computeRangeFacetBucketsEqualWidth(
  shard: FacetShard,
  bucketCount: number,
): void {
  const sorted = shard.sorted ?? [];
  if (sorted.length === 0) return;
  const min = sorted[0]?.value as number;
  const max = sorted[sorted.length - 1]?.value as number;

  if (min === max) {
    // A single distinct value: one bucket, not `bucketCount` degenerate
    // zero-width ones.
    shard.values[formatBucketBound(min)] = {
      count: sorted.length,
      docs: sorted.map((entry) => entry.doc),
    };
    return;
  }

  const width = (max - min) / bucketCount;
  const labels = Array.from({ length: bucketCount }, (_, i) => {
    const lo = min + i * width;
    const hi = min + (i + 1) * width;
    return i === bucketCount - 1
      ? `${formatBucketBound(lo)}+`
      : `${formatBucketBound(lo)}-${formatBucketBound(hi)}`;
  });

  for (const { value, doc } of sorted) {
    const index = Math.min(bucketCount - 1, Math.floor((value - min) / width));
    addToBucket(shard, labels[index] as string, doc);
  }
}

/**
 * Populates a range facet shard's `values` with buckets at
 * author-chosen cut points (`boundaries`, ascending), independent of
 * the corpus's observed `[min, max]` — for fixed real-world brackets
 * (e.g. pricing tiers) an equal-width split would never land on.
 * Standard faceted-search convention (below the first boundary, each
 * `[boundaries[i-1], boundaries[i])` range, at-or-above the last
 * boundary), not tied to the data's own spread the way the equal-width
 * strategy above is — so there's no "single distinct value" special
 * case here: a fixed bucket a value falls into is meaningful
 * regardless of how many other distinct values exist.
 */
function computeRangeFacetBucketsExplicit(
  shard: FacetShard,
  boundaries: number[],
): void {
  const sorted = shard.sorted ?? [];
  if (sorted.length === 0) return;

  const labels = boundaries.map((b, i) =>
    i === 0
      ? `<${formatBucketBound(b)}`
      : `${formatBucketBound(boundaries[i - 1] as number)}-${formatBucketBound(b)}`,
  );
  labels.push(
    `${formatBucketBound(boundaries[boundaries.length - 1] as number)}+`,
  );

  for (const { value, doc } of sorted) {
    let index = boundaries.findIndex((b) => value < b);
    if (index === -1) index = boundaries.length;
    addToBucket(shard, labels[index] as string, doc);
  }
}

interface PinAccumulatorEntry {
  mode: "exact" | "contains";
  /** Kept only for the priority/boost/build-order tie-break below — dropped before writing the shard (pins-shard.schema.json has no boost field). */
  docs: { id: number; priority: number; exclusive: boolean; boost: number }[];
}

/**
 * Resolves the accumulated per-language, per-phrase pin declarations
 * into the final shard shapes, applying the tie-break order from
 * docs/16-term-to-page-pinning.md#conflicting-pins (priority, then doc
 * boost, then build/insertion order — the last relies on Array#sort
 * being a stable sort, guaranteed since ES2019). Returns the finished
 * shards plus one warning string per phrase pinned by more than one
 * distinct page, so the caller can surface them exactly as the docs
 * require ("always emits a build warning"), without buildIndex itself
 * being responsible for how warnings get logged.
 */
function resolvePins(
  pinsAccByLanguage: Map<string, Map<string, PinAccumulatorEntry>>,
): { pinsShards: Record<string, PinsShard>; warnings: string[] } {
  const pinsShards: Record<string, PinsShard> = {};
  const warnings: string[] = [];

  for (const [language, pinsAcc] of pinsAccByLanguage) {
    const pinsShard: PinsShard = {};
    for (const [phrase, acc] of pinsAcc) {
      const sortedDocs = [...acc.docs].sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return b.boost - a.boost;
      });
      const distinctDocIds = new Set(sortedDocs.map((d) => d.id));
      if (distinctDocIds.size > 1) {
        warnings.push(
          `pin conflict: "${phrase}" (${language}) is pinned by ${distinctDocIds.size} pages (doc ids ${[...distinctDocIds].join(", ")}) — resolved by priority/boost/build order; see docs/16-term-to-page-pinning.md#conflicting-pins`,
        );
      }
      pinsShard[phrase] = {
        mode: acc.mode,
        docs: sortedDocs.map(({ id, priority, exclusive }) => ({
          id,
          priority,
          exclusive,
        })),
      };
    }
    pinsShards[language] = pinsShard;
  }

  return { pinsShards, warnings };
}

/**
 * Per-language, persists across every `addPostings()` call for the
 * whole corpus: term -> docId -> that term's already-created `Posting`
 * for that doc, so a second field (`body` after `title`) for the same
 * (term, doc) pair finds its existing posting in O(1) instead of
 * scanning `entry.postings` -- which, before this existed, was an
 * `Array.prototype.find()` over an array that grows up to a term's
 * full document frequency, making a common term's total insertion
 * cost O(df²) and the whole build effectively O(n²) in corpus size
 * (measured: ~31s to index 10k synthetic docs, vs. ~1.1s for 1k --
 * see docs/11-binary-vs-json-index.md's Phase 7 investigation, where
 * this was found while establishing a JSON-tier scaling baseline).
 * Doesn't change `entry.postings`' insertion order or any output
 * shape -- purely a lookup-cost fix.
 */
type PostingIndex = Map<string, Map<number, Posting>>;

function addPostings(
  shard: TermShard,
  postingIndex: PostingIndex,
  field: string,
  docId: number,
  docBoost: number,
  tokens: { term: string; position: number }[],
): void {
  const fieldLength = tokens.length;
  const positionsByTerm = new Map<string, number[]>();
  for (const { term, position } of tokens) {
    const positions = positionsByTerm.get(term) ?? [];
    positions.push(position);
    positionsByTerm.set(term, positions);
  }

  for (const [term, positions] of positionsByTerm) {
    const entry = getOrCreate<TermEntry>(shard, term, () => ({
      df: 0,
      postings: [],
    }));
    let docIndex = postingIndex.get(term);
    if (!docIndex) {
      docIndex = new Map();
      postingIndex.set(term, docIndex);
    }
    let posting = docIndex.get(docId);
    if (!posting) {
      posting = { doc: docId, fields: {} };
      if (docBoost !== 1.0) posting.boost = docBoost;
      entry.postings.push(posting);
      entry.df++;
      docIndex.set(docId, posting);
    }
    posting.fields[field] = {
      tf: positions.length,
      pos: positions,
      len: fieldLength,
    };
  }
}

interface LanguageLengthStats {
  title: number;
  body: number;
  count: number;
}

/**
 * Builds an in-memory index from rendered HTML source documents,
 * matching the "small corpus mode" sizing in
 * docs/14-reference-deployment-cms-2k.md (single, unsharded term shard
 * per language, single doc store). Each document is analyzed under
 * *its own* declared language (`<html lang>`, extract.ts), not a single
 * language for the whole batch — `defaultLanguage` is only the fallback
 * for documents that don't declare one, and doubles as
 * `manifest.defaultLanguage`. File writing/hashing is a separate step
 * (write-index.ts) so this stays a pure, easily-testable function.
 */
export function buildIndex(
  sources: SourceDocument[],
  defaultLanguage = "en",
  options: BuildIndexOptions = {},
): BuiltIndex {
  validateSourceIds(sources);
  const fieldBoosts = { ...DEFAULT_FIELD_BOOSTS, ...options.fieldBoosts };
  const hierarchicalFacets = options.hierarchicalFacets ?? {};
  const rangeFacetBuckets = options.rangeFacetBuckets ?? {};
  for (const [field, config] of Object.entries(rangeFacetBuckets)) {
    if (Array.isArray(config)) {
      if (config.length < 1 || !config.every((n) => Number.isFinite(n))) {
        throw new Error(
          `buildIndex: invalid rangeFacetBuckets boundaries ${JSON.stringify(config)} for field "${field}" — must be a non-empty array of finite numbers`,
        );
      }
      for (let i = 1; i < config.length; i++) {
        if ((config[i] as number) <= (config[i - 1] as number)) {
          throw new Error(
            `buildIndex: invalid rangeFacetBuckets boundaries ${JSON.stringify(config)} for field "${field}" — must be strictly ascending`,
          );
        }
      }
    } else if (!Number.isInteger(config) || config < 1) {
      throw new Error(
        `buildIndex: invalid rangeFacetBuckets count ${JSON.stringify(config)} for field "${field}" — must be a positive integer`,
      );
    }
  }
  const fuzzyMaxEdits = options.fuzzyMaxEdits ?? 1;
  if (fuzzyMaxEdits !== 1 && fuzzyMaxEdits !== 2) {
    throw new Error(
      `buildIndex: invalid fuzzyMaxEdits ${JSON.stringify(fuzzyMaxEdits)} — must be 1 or 2`,
    );
  }

  const termShards: Record<string, TermShard> = {};
  const postingIndexByLanguage = new Map<string, PostingIndex>();
  const docStore: DocStoreShard = {};
  const facetShards: Record<string, FacetShard> = {};
  const pinsAccByLanguage = new Map<string, Map<string, PinAccumulatorEntry>>();
  const statsByLanguage = new Map<string, LanguageLengthStats>();
  let indexedCount = 0;
  let minId = Number.POSITIVE_INFINITY;
  let maxId = Number.NEGATIVE_INFINITY;

  for (const source of sources) {
    const extracted = extractDocument(
      source.html,
      source.url,
      defaultLanguage,
      {
        ...(options.allowedUrlOrigins
          ? { allowedUrlOrigins: options.allowedUrlOrigins }
          : {}),
        ...(options.canonicalBaseUrl
          ? { baseUrl: options.canonicalBaseUrl }
          : {}),
      },
    );
    if (extracted.noindex) continue;

    const language = extracted.language;
    const profile = getLanguageProfile(language);

    const titleTokens = analyze(extracted.title, profile);
    const bodyTokens = analyze(extracted.body, profile);

    let stats = statsByLanguage.get(language);
    if (!stats) {
      stats = { title: 0, body: 0, count: 0 };
      statsByLanguage.set(language, stats);
    }
    stats.title += titleTokens.length;
    stats.body += bodyTokens.length;
    stats.count++;

    let termShard = termShards[language];
    if (!termShard) {
      termShard = {};
      termShards[language] = termShard;
    }
    let postingIndex = postingIndexByLanguage.get(language);
    if (!postingIndex) {
      postingIndex = new Map();
      postingIndexByLanguage.set(language, postingIndex);
    }
    addPostings(
      termShard,
      postingIndex,
      "title",
      source.id,
      extracted.boost,
      titleTokens,
    );
    addPostings(
      termShard,
      postingIndex,
      "body",
      source.id,
      extracted.boost,
      bodyTokens,
    );
    addFacetValues(
      facetShards,
      extracted.facets,
      source.id,
      hierarchicalFacets,
    );
    addRangeFacetValues(facetShards, extracted.rangeFacets, source.id);

    if (extracted.pins.length > 0) {
      let pinsAcc = pinsAccByLanguage.get(language);
      if (!pinsAcc) {
        pinsAcc = new Map();
        pinsAccByLanguage.set(language, pinsAcc);
      }
      for (const pin of extracted.pins) {
        const normalized = normalizePhrase(pin.phrase, profile);
        if (!normalized) continue;
        let acc = pinsAcc.get(normalized);
        if (!acc) {
          acc = { mode: pin.mode, docs: [] };
          pinsAcc.set(normalized, acc);
        }
        acc.docs.push({
          id: source.id,
          priority: pin.priority,
          exclusive: pin.exclusive,
          boost: extracted.boost,
        });
      }
    }

    docStore[String(source.id)] = {
      url: extracted.url,
      ...(extracted.boost !== 1.0 ? { boost: extracted.boost } : {}),
      fields: {
        title: extracted.title,
        excerpt: extracted.excerpt || deriveExcerpt(extracted.body),
      },
    };

    indexedCount++;
    minId = Math.min(minId, source.id);
    maxId = Math.max(maxId, source.id);
  }

  const { pinsShards, warnings } = resolvePins(pinsAccByLanguage);
  for (const warning of warnings) console.warn(`[csf-indexer] ${warning}`);

  // Postings/facet doc-id lists are appended in source-array processing
  // order, which is not a meaningful order (unlike pins' priority-based
  // docs order, deliberately left alone) — sort by doc id so byte-for-
  // byte output doesn't depend on what order the corpus happened to be
  // fed in (REVIEW.md#10, write-index.ts's canonicalize() handles object
  // key order but can't know which arrays are safe to reorder).
  for (const termShard of Object.values(termShards)) {
    for (const entry of Object.values(termShard)) {
      entry.postings.sort((a, b) => a.doc - b.doc);
    }
  }
  for (const [field, facetShard] of Object.entries(facetShards)) {
    // doc id as tiebreaker for documents sharing the same value, so
    // output is deterministic regardless of corpus feed order (same
    // REVIEW.md#10 reasoning as postings/facet-value docs above).
    facetShard.sorted?.sort((a, b) => a.value - b.value || a.doc - b.doc);
    // Needs the full, sorted `sorted` array above -- must run before
    // the values.docs sort below populates and sorts the buckets this
    // computes.
    if (facetShard.type === "range") {
      const config =
        ownProp(rangeFacetBuckets, field) ?? RANGE_FACET_BUCKET_COUNT;
      if (Array.isArray(config)) {
        computeRangeFacetBucketsExplicit(facetShard, config);
      } else {
        computeRangeFacetBucketsEqualWidth(facetShard, config);
      }
    }
  }
  for (const facetShard of Object.values(facetShards)) {
    for (const entry of Object.values(facetShard.values)) {
      entry.docs.sort((a, b) => a - b);
    }
  }

  const facetFields = Object.keys(facetShards).sort();
  // An empty corpus still needs one language for the manifest to make
  // sense at all — fall back to defaultLanguage with zeroed stats.
  const languages = statsByLanguage.size
    ? [...statsByLanguage.keys()].sort()
    : [defaultLanguage];

  const docCount: Record<string, number> = {};
  const avgFieldLength: Record<string, Record<string, number>> = {};
  for (const language of languages) {
    const stats = statsByLanguage.get(language);
    docCount[language] = stats?.count ?? 0;
    avgFieldLength[language] = {
      title: stats?.count ? stats.title / stats.count : 0,
      body: stats?.count ? stats.body / stats.count : 0,
    };
  }

  const fuzzyShards: Record<string, FuzzyShard> = {};
  if (options.fuzzy) {
    for (const [language, termShard] of Object.entries(termShards)) {
      fuzzyShards[language] = buildFuzzyShard(termShard, fuzzyMaxEdits);
    }
  }

  return {
    termShards,
    docStore,
    facetShards,
    pinsShards,
    synonymShards: buildSynonymShards(options.synonyms),
    fuzzyShards,
    idRange: indexedCount ? [minId, maxId] : [0, 0],
    manifest: {
      version: 1,
      buildId: new Date().toISOString(),
      format: "json",
      languages,
      defaultLanguage,
      fields: {
        title: { boost: fieldBoosts.title, stored: true },
        body: { boost: fieldBoosts.body, stored: false },
      },
      ...(facetFields.length ? { facetFields } : {}),
      docCount,
      avgFieldLength,
      shards: { terms: [], docs: [] },
    },
  };
}
