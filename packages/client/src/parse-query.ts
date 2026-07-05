import { analyze } from "@csf/analysis";
import type { LanguageProfile } from "@csf/analysis";

export interface QueryTerm {
  /** Analyzed (lowercased/stemmed) term or prefix, ready for lookup. */
  term: string;
  /** true for a trailing-`*` prefix query (docs/04-query-ranking-boosts.md#prefix--fuzzy-matching). */
  prefix: boolean;
}

/**
 * Splits the raw query string on whitespace *before* running analysis,
 * so a trailing `*` can be detected and stripped per raw token — running
 * analyze() on the whole query string first would lose that signal,
 * since `*` isn't word-like and a segmenter would just discard it
 * silently. Each remaining raw token is then analyzed normally (so a
 * prefix query still gets lowercased/stemmed like any other term).
 */
export function parseQueryTerms(
  query: string,
  profile: LanguageProfile,
): QueryTerm[] {
  const rawTokens = query.trim().split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  const result: QueryTerm[] = [];

  for (const raw of rawTokens) {
    const isPrefix = raw.length > 1 && raw.endsWith("*");
    const text = isPrefix ? raw.slice(0, -1) : raw;

    for (const token of analyze(text, profile)) {
      const key = `${isPrefix ? "prefix:" : "exact:"}${token.term}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ term: token.term, prefix: isPrefix });
    }
  }

  return result;
}
