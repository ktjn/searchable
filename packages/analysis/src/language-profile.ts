import { segmentCjkBigram } from "./segment-cjk.js";
import { stemGerman } from "./stemmer-de.js";
import { stemEnglish } from "./stemmer-en.js";

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

/**
 * Real affix-stripping stemming (docs/03-tokenization-i18n.md#stemming)
 * via the classic Porter algorithm (`./stemmer-en.ts`) — no stopword
 * removal yet.
 */
export const english: LanguageProfile = {
  code: "en",
  segment: segmentWithIntl("en"),
  foldDiacritics: false,
  stopwords: new Set(),
  stem: stemEnglish,
};

/**
 * Real affix-stripping stemming via the Snowball German algorithm
 * (`./stemmer-de.ts`) — no stopword removal yet. `foldDiacritics:
 * false` below is a *separate* concern that no longer fully delivers
 * on its original promise now that stemming is real: that flag only
 * controls whether raw, *unstemmed* text folds diacritics before
 * analysis; it says nothing about what the stemmer itself does
 * afterward. The Snowball algorithm's own final step unconditionally
 * folds any remaining ä/ö/ü to a/o/u — standard, spec-correct behavior
 * (matches Lucene's and PyStemmer's German stemmers too) — so `schon`
 * and `schön` now both stem to `"schon"` even though `foldDiacritics:
 * false` keeps them distinct going *into* `stem()`. See
 * docs/03-tokenization-i18n.md#case-folding--diacritics for the full
 * writeup of this tradeoff.
 */
export const german: LanguageProfile = {
  code: "de",
  segment: segmentWithIntl("de"),
  foldDiacritics: false,
  stopwords: new Set(),
  stem: stemGerman,
};

/**
 * Bigram (n-gram) fallback segmentation (`./segment-cjk.ts`) rather
 * than dictionary-based `Intl.Segmenter("zh"|"ja")` word segmentation
 * (docs/03-tokenization-i18n.md#segmentation) — guarantees correct
 * substring matching in any environment without a bundled dictionary,
 * at the cost of index size (overlapping bigrams) and some relevance
 * precision (no real word boundaries), a documented, accepted
 * tradeoff. `stem` is the identity function: Chinese and Japanese
 * don't have Indo-European-style inflectional morphology that
 * affix-stripping stemming targets, matching every other
 * non-affix-stripping language this project documents as a stemming
 * no-op. `foldDiacritics` is meaningless for these scripts (no
 * diacritics), left `false` for consistency with every profile that
 * isn't specifically opting in.
 */
export const chinese: LanguageProfile = {
  code: "zh",
  segment: segmentCjkBigram,
  foldDiacritics: false,
  stopwords: new Set(),
  stem: (term) => term,
};

/** Same bigram-fallback segmentation as `chinese` above -- the fallback mechanism doesn't depend on which CJK language the text is in, only its script (docs/03-tokenization-i18n.md#segmentation). */
export const japanese: LanguageProfile = {
  code: "ja",
  segment: segmentCjkBigram,
  foldDiacritics: false,
  stopwords: new Set(),
  stem: (term) => term,
};

export { stripDiacritics };
