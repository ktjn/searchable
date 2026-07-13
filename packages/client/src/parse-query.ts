import type { LanguageProfile } from "@csf/analysis";
import { analyze } from "@csf/analysis";

export interface QueryTerm {
  /** Analyzed (lowercased/stemmed) term or prefix, ready for lookup. */
  term: string;
  /** true for a trailing-`*` prefix query (docs/guides/ranking-and-boosts.md#prefix-and-fuzzy-matching). */
  prefix: boolean;
  /** Lowercased but *not* stemmed surface form of this term (@csf/analysis's `Token.literal`) -- used for result highlighting, which matches raw stored text where a stemmed term wouldn't. */
  literal: string;
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
      result.push({
        term: token.term,
        prefix: isPrefix,
        literal: token.literal,
      });
    }
  }

  return result;
}

/**
 * A `"quoted phrase"` clause (docs/guides/ranking-and-boosts.md#phrase-and-proximity-queries):
 * every term must appear at consecutive positions, in this exact
 * order, within the same field of a matching document — not merely
 * present independently, the way a bare space-separated AND of the
 * same words would already be satisfied.
 */
export interface PhraseTerm {
  terms: QueryTerm[];
}

export interface ParsedQuery {
  /** Every non-phrase term (existing single-term/prefix behavior, unaffected by any phrases in the same query). */
  terms: QueryTerm[];
  /** Every quoted phrase clause, in the order encountered. */
  phrases: PhraseTerm[];
}

/**
 * Splits `"quoted phrases"` out of the raw query string before the
 * existing space-separated term/prefix parsing runs on what's left —
 * e.g. `wireless "noise cancelling" headphones` becomes the phrase
 * clause `["noise", "cancelling"]` plus the ordinary terms `wireless`
 * and `headphones`. An unterminated quote or an empty `""` is silently
 * ignored (falls through to plain term parsing, where the tokenizer
 * already drops bare punctuation like a lone `"`), matching the
 * parser's existing tolerance for odd input elsewhere (e.g. a stray
 * trailing `*`).
 */
export function parseQuery(
  query: string,
  profile: LanguageProfile,
): ParsedQuery {
  const phrases: PhraseTerm[] = [];
  const remainder = query.replace(/"([^"]+)"/g, (_match, inner: string) => {
    const phraseTerms: QueryTerm[] = [];
    for (const raw of inner.trim().split(/\s+/).filter(Boolean)) {
      for (const token of analyze(raw, profile)) {
        phraseTerms.push({
          term: token.term,
          prefix: false,
          literal: token.literal,
        });
      }
    }
    if (phraseTerms.length > 0) phrases.push({ terms: phraseTerms });
    return " ";
  });
  return { terms: parseQueryTerms(remainder, profile), phrases };
}
