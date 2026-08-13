import { generateDeletes, ownProp } from "./analysis/index.js";
import type { ShardCache } from "./fetch-json.js";
import type { FuzzyShard, Manifest } from "./format/index.js";
import { resolve } from "./url.js";

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
 * direct property read).
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
      `[searchable-client] fuzzy lookup for "${term}" found ${candidateTerms.length} dictionary candidates, over the ${MAX_FUZZY_CANDIDATES_PER_TERM}-candidate cap -- scoring only the first ${MAX_FUZZY_CANDIDATES_PER_TERM} (not necessarily the closest). A dense vocabulary this large may want a shorter query term, a smaller fuzzyMaxEdits, or this project's benchmarking data to size the tradeoff (docs/project/governance.md).`,
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
export function fuzzyMatchesFor(
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
export function nearestTermsFor(
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
 * `FuzzyLookup`.
 */
export async function loadFuzzyLookup(
  manifest: Manifest,
  cache: ShardCache,
  baseUrl: string,
  language: string,
): Promise<FuzzyLookup | undefined> {
  const entry = manifest.fuzzy && ownProp(manifest.fuzzy, language);
  if (!entry) return undefined;
  const shard = await cache.fetchJson<FuzzyShard>(resolve(baseUrl, entry.file));
  return {
    maxEdits: shard.maxEdits,
    get: (variant) => ownProp(shard.deletions, variant) ?? [],
  };
}
