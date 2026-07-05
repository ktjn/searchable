import { analyze, getLanguageProfile } from "@csf/analysis";
import type {
  DocStoreEntry,
  Manifest,
  TermEntry,
  TermShard,
} from "@csf/format";
import type { ShardCache } from "./fetch-json.js";
import { scoreTermForDoc } from "./score.js";

export interface Hit {
  id: number;
  score: number;
  url: string;
  fields: Record<string, string>;
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
}

function resolve(baseUrl: string, relPath: string): string {
  return new URL(relPath, baseUrl).toString();
}

/**
 * Boolean-AND query evaluation over the shards a query actually needs
 * (docs/01-architecture.md#data-flow-for-a-query): analyze the query
 * with the same LanguageProfile the indexer used, fetch only the term
 * shard(s) covering the matched language, intersect posting doc-id
 * sets across every query term, score the intersection with BM25F, and
 * fetch doc-store data for only the final top-N hits.
 */
export async function search(
  query: string,
  manifest: Manifest,
  cache: ShardCache,
  baseUrl: string,
  options: SearchOptions = {},
): Promise<Hit[]> {
  const language = options.language ?? manifest.defaultLanguage;
  const profile = getLanguageProfile(language);

  const terms = [...new Set(analyze(query, profile).map((t) => t.term))];
  if (terms.length === 0) return [];

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

  const matchedPairs = terms.map((term) => ({
    term,
    entry: termLookup.get(term),
  }));
  if (matchedPairs.some(({ entry }) => entry === undefined)) {
    return []; // boolean AND: every query term must be present somewhere
  }
  const matchedTerms = matchedPairs as { term: string; entry: TermEntry }[];

  const docIdSets = matchedTerms.map(
    ({ entry }) => new Set(entry.postings.map((p) => p.doc)),
  );
  const [first, ...rest] = docIdSets;
  const candidateIds = [...(first ?? [])].filter((id) =>
    rest.every((set) => set.has(id)),
  );
  const candidateSet = new Set(candidateIds);

  const scores = new Map<number, number>();
  const docBoosts = new Map<number, number>();
  for (const { term, entry } of matchedTerms) {
    const termBoost = options.boosts?.terms?.[term] ?? 1.0;
    for (const posting of entry.postings) {
      if (!candidateSet.has(posting.doc)) continue;
      const s =
        scoreTermForDoc(posting, entry.df, manifest, options.boosts?.fields) *
        termBoost;
      scores.set(posting.doc, (scores.get(posting.doc) ?? 0) + s);
      if (posting.boost !== undefined)
        docBoosts.set(posting.doc, posting.boost);
    }
  }

  // Document boost is a final multiplier on the summed term score
  // (docs/04-query-ranking-boosts.md#boost-types-summarized) — applied
  // once here, not folded into scoreTermForDoc, so it stays a cheap,
  // independent knob rather than term-level math.
  const ranked = candidateIds
    .map((id) => ({
      id,
      score: (scores.get(id) ?? 0) * (docBoosts.get(id) ?? 1.0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? 10);

  const docShardEntries = manifest.shards.docs.filter((d) =>
    ranked.some((r) => r.id >= d.idRange[0] && r.id <= d.idRange[1]),
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

  return ranked.map(({ id, score }) => {
    const doc = docLookup.get(id);
    return { id, score, url: doc?.url ?? "", fields: doc?.fields ?? {} };
  });
}
