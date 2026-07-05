import { analyze, getLanguageProfile, normalizePhrase } from "@csf/analysis";
import { extractDocument } from "./extract.js";
import type {
  BuiltIndex,
  DocStoreShard,
  FacetShard,
  PinsShard,
  SourceDocument,
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

interface PinAccumulatorEntry {
  mode: "exact" | "contains";
  /** Kept only for the priority/boost/build-order tie-break below — dropped before writing the shard (pins-shard.schema.json has no boost field). */
  docs: { id: number; priority: number; exclusive: boolean; boost: number }[];
}

/**
 * Resolves the accumulated per-phrase pin declarations into the final
 * shard shape, applying the tie-break order from
 * docs/16-term-to-page-pinning.md#conflicting-pins (priority, then doc
 * boost, then build/insertion order — the last relies on Array#sort
 * being a stable sort, guaranteed since ES2019). Returns the finished
 * shard plus one warning string per phrase pinned by more than one
 * distinct page, so the caller can surface them exactly as the docs
 * require ("always emits a build warning"), without buildIndex itself
 * being responsible for how warnings get logged.
 */
function resolvePins(pinsAcc: Map<string, PinAccumulatorEntry>): {
  pinsShard: PinsShard;
  warnings: string[];
} {
  const pinsShard: PinsShard = {};
  const warnings: string[] = [];

  for (const [phrase, acc] of pinsAcc) {
    const sortedDocs = [...acc.docs].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return b.boost - a.boost;
    });
    const distinctDocIds = new Set(sortedDocs.map((d) => d.id));
    if (distinctDocIds.size > 1) {
      warnings.push(
        `pin conflict: "${phrase}" is pinned by ${distinctDocIds.size} pages (doc ids ${[...distinctDocIds].join(", ")}) — resolved by priority/boost/build order; see docs/16-term-to-page-pinning.md#conflicting-pins`,
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

  return { pinsShard, warnings };
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

/**
 * Builds an in-memory index from rendered HTML source documents — single
 * language, single (unsharded) term shard and doc store, matching the
 * "small corpus mode" sizing in docs/14-reference-deployment-cms-2k.md.
 * File writing/hashing is a separate step (write-index.ts) so this stays
 * a pure, easily-testable function.
 */
export function buildIndex(
  sources: SourceDocument[],
  language = "en",
  options: BuildIndexOptions = {},
): BuiltIndex {
  const profile = getLanguageProfile(language);
  const fieldBoosts = { ...DEFAULT_FIELD_BOOSTS, ...options.fieldBoosts };

  const termShard: TermShard = {};
  const docStore: DocStoreShard = {};
  const facetShards: Record<string, FacetShard> = {};
  const pinsAcc = new Map<string, PinAccumulatorEntry>();
  let titleLengthSum = 0;
  let bodyLengthSum = 0;
  let indexedCount = 0;
  let minId = Number.POSITIVE_INFINITY;
  let maxId = Number.NEGATIVE_INFINITY;

  for (const source of sources) {
    const extracted = extractDocument(source.html, source.url);
    if (extracted.noindex) continue;

    const titleTokens = analyze(extracted.title, profile);
    const bodyTokens = analyze(extracted.body, profile);

    titleLengthSum += titleTokens.length;
    bodyLengthSum += bodyTokens.length;

    addPostings(termShard, "title", source.id, extracted.boost, titleTokens);
    addPostings(termShard, "body", source.id, extracted.boost, bodyTokens);
    addFacetValues(facetShards, extracted.facets, source.id);

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

  const { pinsShard, warnings } = resolvePins(pinsAcc);
  for (const warning of warnings) console.warn(`[csf-indexer] ${warning}`);

  const facetFields = Object.keys(facetShards).sort();

  return {
    language,
    termShard,
    docStore,
    facetShards,
    pinsShard,
    idRange: indexedCount ? [minId, maxId] : [0, 0],
    manifest: {
      version: 1,
      buildId: new Date().toISOString(),
      format: "json",
      languages: [language],
      defaultLanguage: language,
      fields: {
        title: { boost: fieldBoosts.title, stored: true },
        body: { boost: fieldBoosts.body, stored: false },
      },
      ...(facetFields.length ? { facetFields } : {}),
      docCount: indexedCount,
      avgFieldLength: {
        title: indexedCount ? titleLengthSum / indexedCount : 0,
        body: indexedCount ? bodyLengthSum / indexedCount : 0,
      },
      shards: { terms: [], docs: [] },
    },
  };
}
