import { segmentCjkBigram } from "./segment-cjk.js";
import { segmentSeaTrigram } from "./segment-sea.js";
import { stemGerman } from "./stemmer-de.js";
import { stemEnglish } from "./stemmer-en.js";
import { stemDutch } from "./stemmer-nl.js";
import { stemNorwegian } from "./stemmer-no.js";
import { stemSwedish } from "./stemmer-sv.js";
import {
  CJK_STOPWORDS,
  DUTCH_STOPWORDS,
  ENGLISH_STOPWORDS,
  GERMAN_STOPWORDS,
  NORWEGIAN_STOPWORDS,
  SWEDISH_STOPWORDS,
  THAI_STOPWORDS,
} from "./stopwords.js";

export interface TokenSpan {
  text: string;
  isWordLike: boolean;
}

/**
 * Per-language analysis behavior. Indexer and runtime both consume the
 * same profile via `analyze()` so index-time and query-time tokenization
 * can never drift apart (see docs/guides/internationalization.md).
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
 * Real affix-stripping stemming (docs/guides/internationalization.md#stemming)
 * via the classic Porter algorithm (`./stemmer-en.ts`) — filtering standard
 * function/interrogative words at analysis time (shared by indexer and runtime).
 */
export const english: LanguageProfile = {
  code: "en",
  segment: segmentWithIntl("en"),
  foldDiacritics: false,
  stopwords: ENGLISH_STOPWORDS,
  stem: stemEnglish,
};

/**
 * Real affix-stripping stemming via the Snowball German algorithm
 * (`./stemmer-de.ts`) — filtering standard function/interrogative words
 * at analysis time. `foldDiacritics: false` below is a *separate*
 * concern that no longer fully delivers on its original promise now
 * that stemming is real: that flag only controls whether raw,
 * *unstemmed* text folds diacritics before analysis; it says nothing
 * about what the stemmer itself does afterward. The Snowball
 * algorithm's own final step unconditionally folds any remaining
 * ä/ö/ü to a/o/u — standard, spec-correct behavior (matches Lucene's
 * and PyStemmer's German stemmers too) — so `schon` and `schön` now
 * both stem to `"schon"` even though `foldDiacritics: false` keeps
 * them distinct going *into* `stem()`. See
 * docs/guides/internationalization.md#case-folding-and-diacritics for the full
 * writeup of this tradeoff.
 */
export const german: LanguageProfile = {
  code: "de",
  segment: segmentWithIntl("de"),
  foldDiacritics: false,
  stopwords: GERMAN_STOPWORDS,
  stem: stemGerman,
};

export const swedish: LanguageProfile = {
  code: "sv",
  segment: segmentWithIntl("sv"),
  foldDiacritics: false,
  stopwords: SWEDISH_STOPWORDS,
  stem: stemSwedish,
};

export const dutch: LanguageProfile = {
  code: "nl",
  segment: segmentWithIntl("nl"),
  foldDiacritics: false,
  stopwords: DUTCH_STOPWORDS,
  stem: stemDutch,
};

export const norwegianBokmal: LanguageProfile = {
  code: "nb",
  segment: segmentWithIntl("nb"),
  foldDiacritics: false,
  stopwords: NORWEGIAN_STOPWORDS,
  stem: stemNorwegian,
};

export const norwegianNynorsk: LanguageProfile = {
  code: "nn",
  segment: segmentWithIntl("nn"),
  foldDiacritics: false,
  stopwords: NORWEGIAN_STOPWORDS,
  stem: stemNorwegian,
};

/** Generic Norwegian compatibility code. Detection returns `nb` or `nn`. */
export const norwegian: LanguageProfile = {
  code: "no",
  segment: segmentWithIntl("no"),
  foldDiacritics: false,
  stopwords: NORWEGIAN_STOPWORDS,
  stem: stemNorwegian,
};

/**
 * Bigram (n-gram) fallback segmentation (`./segment-cjk.ts`) rather
 * than dictionary-based `Intl.Segmenter("zh"|"ja")` word segmentation
 * (docs/guides/internationalization.md#segmentation) — guarantees correct
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
  stopwords: CJK_STOPWORDS,
  stem: (term) => term,
};

/** Same bigram-fallback segmentation as `chinese` above -- the fallback mechanism doesn't depend on which CJK language the text is in, only its script (docs/guides/internationalization.md#segmentation). */
export const japanese: LanguageProfile = {
  code: "ja",
  segment: segmentCjkBigram,
  foldDiacritics: false,
  stopwords: CJK_STOPWORDS,
  stem: (term) => term,
};

/**
 * Trigram (n-gram) fallback segmentation (`./segment-sea.ts`), the same
 * robustness-net strategy as `chinese`/`japanese` above but at width 3
 * rather than 2 (see that module's own doc comment for why). `stem` is
 * the identity function for the same reason as `chinese`/`japanese`:
 * none of these scripts have Indo-European-style inflectional
 * morphology that affix-stripping stemming targets. `foldDiacritics` is
 * deliberately `false`: Thai/Khmer/Lao vowel signs and tone marks are
 * Unicode combining marks but are *not* decorative diacritics -- they
 * distinguish otherwise-identical words, so running them through
 * `stripDiacritics()`'s NFKD-then-strip-combining-marks logic (built for
 * Latin-script accents) would silently conflate distinct words.
 */
export const thai: LanguageProfile = {
  code: "th",
  segment: segmentSeaTrigram,
  foldDiacritics: false,
  stopwords: THAI_STOPWORDS,
  stem: (term) => term,
};

/** Same trigram-fallback segmentation as `thai` above -- the fallback mechanism doesn't depend on which of the three scripts the text is in (docs/guides/internationalization.md#segmentation). */
export const khmer: LanguageProfile = {
  code: "km",
  segment: segmentSeaTrigram,
  foldDiacritics: false,
  stopwords: CJK_STOPWORDS,
  stem: (term) => term,
};

/** Same trigram-fallback segmentation as `thai` above -- the fallback mechanism doesn't depend on which of the three scripts the text is in (docs/guides/internationalization.md#segmentation). */
export const lao: LanguageProfile = {
  code: "lo",
  segment: segmentSeaTrigram,
  foldDiacritics: false,
  stopwords: CJK_STOPWORDS,
  stem: (term) => term,
};

export { stripDiacritics };
