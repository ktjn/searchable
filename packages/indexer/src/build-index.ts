import { analyze, getLanguageProfile, normalizePhrase } from "@csf/analysis";
import { extractDocument } from "./extract.js";
import type {
  BuiltIndex,
  DocStoreShard,
  FacetShard,
  FuzzyShard,
  PinsShard,
  SourceDocument,
  SynonymShard,
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
   * `multiWord` phrase synonyms aren't accepted here yet (see
   * SynonymShard).
   */
  synonyms?: Record<string, Pick<SynonymShard, "equivalences" | "directional">>;
  /**
   * Build a SymSpell-style deletion dictionary (docs/04-query-ranking-boosts.md#prefix--fuzzy-matching)
   * from each language's own indexed term vocabulary, enabling
   * typo-tolerant fuzzy matching at query time. Off by default: the
   * dictionary adds real index size (roughly proportional to total
   * term length across the vocabulary) that not every deployment wants
   * to pay for. Only distance-1 deletions are generated.
   */
  fuzzy?: boolean;
}

/** Unique strings reachable by deleting exactly one Unicode code point from `term` (plus `term` itself, 0 deletions). */
function generateDeletes(term: string): string[] {
  const chars = [...term];
  const variants = new Set<string>([term]);
  for (let i = 0; i < chars.length; i++) {
    variants.add(chars.slice(0, i).join("") + chars.slice(i + 1).join(""));
  }
  return [...variants];
}

/**
 * Builds a distance-1 SymSpell deletion dictionary from a language's
 * term-shard vocabulary: every deletion-variant of every real term maps
 * back to the term(s) that produced it. This is purely derived from
 * what's already indexed (unlike synonyms/pins, there's nothing to
 * author) — it's regenerated fresh from `termShard`'s own keys.
 */
function buildFuzzyShard(termShard: TermShard): FuzzyShard {
  const deletionSets: Record<string, Set<string>> = {};
  for (const term of Object.keys(termShard)) {
    for (const variant of generateDeletes(term)) {
      if (!deletionSets[variant]) deletionSets[variant] = new Set();
      deletionSets[variant].add(term);
    }
  }
  const deletions: Record<string, string[]> = {};
  for (const [variant, terms] of Object.entries(deletionSets)) {
    deletions[variant] = [...terms].sort();
  }
  return { maxEdits: 1, deletions };
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

    const shard: SynonymShard = {};
    if (equivalences.length) shard.equivalences = equivalences;
    if (Object.keys(directional).length) shard.directional = directional;
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
): void {
  for (const [field, values] of Object.entries(facets)) {
    let shard = facetShards[field];
    if (!shard) {
      shard = { type: "terms", values: {} };
      facetShards[field] = shard;
    } else if (shard.type !== "terms") {
      continue; // same field also declared as a range facet elsewhere -- first declaration wins
    }
    for (const value of values) {
      let entry = shard.values[value];
      if (!entry) {
        entry = { count: 0, docs: [] };
        shard.values[value] = entry;
      }
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
 * are processed, by `computeRangeFacetBuckets()` below -- aggregate
 * *results* (the display-side histogram/bucket breakdown) and
 * filtering are two independent capabilities on the same shard.
 */
function addRangeFacetValues(
  facetShards: Record<string, FacetShard>,
  rangeFacets: Record<string, number>,
  docId: number,
): void {
  for (const [field, value] of Object.entries(rangeFacets)) {
    let shard = facetShards[field];
    if (!shard) {
      shard = { type: "range", values: {}, sorted: [] };
      facetShards[field] = shard;
    } else if (shard.type !== "range") {
      continue; // same field also declared as a terms facet elsewhere -- first declaration wins
    }
    shard.sorted?.push({ value, doc: docId });
  }
}

/** Number of equal-width buckets computed for a range facet's aggregate results (docs/06-faceted-search.md#facet-index-structure). */
const RANGE_FACET_BUCKET_COUNT = 5;

/** Formats a bucket boundary without a trailing ".00" for whole numbers. */
function formatBucketBound(n: number): string {
  return Number(n.toFixed(2)).toString();
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
function computeRangeFacetBuckets(shard: FacetShard): void {
  const sorted = shard.sorted ?? [];
  if (sorted.length === 0) return;
  const min = sorted[0]?.value as number;
  const max = sorted[sorted.length - 1]?.value as number;

  if (min === max) {
    // A single distinct value: one bucket, not RANGE_FACET_BUCKET_COUNT
    // degenerate zero-width ones.
    shard.values[formatBucketBound(min)] = {
      count: sorted.length,
      docs: sorted.map((entry) => entry.doc),
    };
    return;
  }

  const width = (max - min) / RANGE_FACET_BUCKET_COUNT;
  const labels = Array.from({ length: RANGE_FACET_BUCKET_COUNT }, (_, i) => {
    const lo = min + i * width;
    const hi = min + (i + 1) * width;
    return i === RANGE_FACET_BUCKET_COUNT - 1
      ? `${formatBucketBound(lo)}+`
      : `${formatBucketBound(lo)}-${formatBucketBound(hi)}`;
  });

  for (const { value, doc } of sorted) {
    const index = Math.min(
      RANGE_FACET_BUCKET_COUNT - 1,
      Math.floor((value - min) / width),
    );
    const label = labels[index] as string;
    let entry = shard.values[label];
    if (!entry) {
      entry = { count: 0, docs: [] };
      shard.values[label] = entry;
    }
    entry.docs.push(doc);
    entry.count++;
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

function addPostings(
  shard: TermShard,
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
    let entry = shard[term];
    if (!entry) {
      entry = { df: 0, postings: [] };
      shard[term] = entry;
    }
    let posting = entry.postings.find((p) => p.doc === docId);
    if (!posting) {
      posting = { doc: docId, fields: {} };
      if (docBoost !== 1.0) posting.boost = docBoost;
      entry.postings.push(posting);
      entry.df++;
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

  const termShards: Record<string, TermShard> = {};
  const docStore: DocStoreShard = {};
  const facetShards: Record<string, FacetShard> = {};
  const pinsAccByLanguage = new Map<string, Map<string, PinAccumulatorEntry>>();
  const statsByLanguage = new Map<string, LanguageLengthStats>();
  let indexedCount = 0;
  let minId = Number.POSITIVE_INFINITY;
  let maxId = Number.NEGATIVE_INFINITY;

  for (const source of sources) {
    const extracted = extractDocument(source.html, source.url, defaultLanguage);
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
    addPostings(termShard, "title", source.id, extracted.boost, titleTokens);
    addPostings(termShard, "body", source.id, extracted.boost, bodyTokens);
    addFacetValues(facetShards, extracted.facets, source.id);
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
  for (const facetShard of Object.values(facetShards)) {
    // doc id as tiebreaker for documents sharing the same value, so
    // output is deterministic regardless of corpus feed order (same
    // REVIEW.md#10 reasoning as postings/facet-value docs above).
    facetShard.sorted?.sort((a, b) => a.value - b.value || a.doc - b.doc);
    // Needs the full, sorted `sorted` array above -- must run before
    // the values.docs sort below populates and sorts the buckets this
    // computes.
    if (facetShard.type === "range") computeRangeFacetBuckets(facetShard);
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
      fuzzyShards[language] = buildFuzzyShard(termShard);
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
