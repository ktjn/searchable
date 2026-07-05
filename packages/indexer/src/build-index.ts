import { analyze, getLanguageProfile } from "@csf/analysis";
import { extractDocument } from "./extract.js";
import type {
  BuiltIndex,
  DocStoreShard,
  SourceDocument,
  TermShard,
} from "./types.js";

const EXCERPT_LENGTH = 200;

function deriveExcerpt(body: string): string {
  return body.length <= EXCERPT_LENGTH
    ? body
    : `${body.slice(0, EXCERPT_LENGTH).trimEnd()}…`;
}

function addPostings(
  shard: TermShard,
  field: string,
  docId: number,
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
): BuiltIndex {
  const profile = getLanguageProfile(language);

  const termShard: TermShard = {};
  const docStore: DocStoreShard = {};
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

    addPostings(termShard, "title", source.id, titleTokens);
    addPostings(termShard, "body", source.id, bodyTokens);

    docStore[String(source.id)] = {
      url: extracted.url,
      fields: {
        title: extracted.title,
        excerpt: extracted.excerpt || deriveExcerpt(extracted.body),
      },
    };

    indexedCount++;
    minId = Math.min(minId, source.id);
    maxId = Math.max(maxId, source.id);
  }

  return {
    language,
    termShard,
    docStore,
    idRange: indexedCount ? [minId, maxId] : [0, 0],
    manifest: {
      version: 1,
      buildId: new Date().toISOString(),
      format: "json",
      languages: [language],
      defaultLanguage: language,
      fields: {
        title: { boost: 1.0, stored: true },
        body: { boost: 1.0, stored: false },
      },
      docCount: indexedCount,
      avgFieldLength: {
        title: indexedCount ? titleLengthSum / indexedCount : 0,
        body: indexedCount ? bodyLengthSum / indexedCount : 0,
      },
      shards: { terms: [], docs: [] },
    },
  };
}
