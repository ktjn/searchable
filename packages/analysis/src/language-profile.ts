export interface TokenSpan {
  text: string;
  isWordLike: boolean;
}

/**
 * Per-language analysis behavior. Indexer and runtime both consume the
 * same profile via `analyze()` so index-time and query-time tokenization
 * can never drift apart (see docs/03-tokenization-i18n.md).
 */
export interface LanguageProfile {
  code: string;
  segment(text: string): TokenSpan[];
  foldDiacritics: boolean;
  stopwords: ReadonlySet<string>;
  stem(term: string): string;
}

function segmentWithIntl(code: string): (text: string) => TokenSpan[] {
  const segmenter = new Intl.Segmenter(code, { granularity: "word" });
  return (text: string) =>
    Array.from(segmenter.segment(text), (s) => ({
      text: s.segment,
      isWordLike: s.isWordLike ?? false,
    }));
}

// Unicode "Mark" category: combining diacritics left behind by NFKD
// decomposition (e.g. \u00e9 -> e + combining acute accent).
const COMBINING_MARKS = /\p{M}/gu;

function stripDiacritics(term: string): string {
  return term.normalize("NFKD").replace(COMBINING_MARKS, "");
}

/** No stemming/stopword removal yet — identity pass, shape ready for both. */
export const english: LanguageProfile = {
  code: "en",
  segment: segmentWithIntl("en"),
  foldDiacritics: false,
  stopwords: new Set(),
  stem: (term) => term,
};

export { stripDiacritics };
