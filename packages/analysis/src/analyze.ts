import { type LanguageProfile, stripDiacritics } from "./language-profile.js";

export interface Token {
  term: string;
  position: number;
}

/**
 * The one analysis pipeline shared by the indexer and the runtime.
 * Index-time and query-time calls MUST go through this same function
 * with the same profile, or matching silently breaks (docs/03).
 */
export function analyze(text: string, profile: LanguageProfile): Token[] {
  const normalized = text.normalize("NFKC");
  const tokens: Token[] = [];
  let position = 0;

  for (const span of profile.segment(normalized)) {
    if (!span.isWordLike) continue;

    let term = span.text.toLocaleLowerCase(profile.code);
    if (profile.foldDiacritics) term = stripDiacritics(term);
    if (profile.stopwords.has(term)) continue;

    term = profile.stem(term);
    tokens.push({ term, position });
    position++;
  }

  return tokens;
}
