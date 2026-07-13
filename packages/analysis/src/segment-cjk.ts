/**
 * Bigram (n-gram) fallback segmentation for CJK text
 * (docs/guides/internationalization.md#segmentation): "no whitespace between
 * words, so naive word segmentation is wrong... falling back to n-gram
 * (bigram) indexing as a robustness net for locales/environments where
 * `Intl.Segmenter` support is incomplete — bigram indexing trades some
 * precision for guaranteed correctness without a bundled dictionary."
 * This module implements that fallback outright (not gated behind
 * detecting incomplete `Intl.Segmenter` support, which isn't reliably
 * detectable across the arbitrary browsers/Node versions this runtime
 * targets) rather than the higher-precision dictionary-based
 * `Intl.Segmenter("zh"|"ja")` path, which remains a future upgrade —
 * see the `chinese`/`japanese` `LanguageProfile`s in
 * `./language-profile.ts`.
 *
 * A run of consecutive CJK-range characters (Han ideographs, hiragana,
 * katakana) is split into overlapping 2-character windows advancing by
 * one character at a time, e.g. "自然語言" -> "自然", "然語", "語言" —
 * so a query for any 2-character substring that actually appears in a
 * document finds it, without ever needing a word-boundary dictionary.
 * A lone single-character CJK run (there's no second character to pair
 * with) is indexed as that one character rather than dropped entirely,
 * so single-character words remain searchable. A run of non-CJK
 * characters (Latin words, digits, punctuation, whitespace — CJK text
 * routinely mixes in these, e.g. product codes or English loanwords)
 * is segmented normally via `Intl.Segmenter`, exactly like the
 * space-delimited-language profiles. The run-scanning/windowing
 * mechanics themselves live in `./segment-ngram.ts`, shared with
 * `./segment-sea.ts`'s trigram Thai/Khmer/Lao fallback.
 */

import type { TokenSpan } from "./language-profile.js";
import { segmentByScriptNgram } from "./segment-ngram.js";

// Han ideographs (+ Extension A), hiragana, katakana -- deliberately
// excludes Hangul (Korean is whitespace-delimited at the word level,
// docs/guides/internationalization.md#segmentation) and Thai/Khmer/Lao (see
// `./segment-sea.ts`'s own trigram profile with its own script ranges).
const CJK_CHAR = /[\u{3040}-\u{30FF}\u{3400}-\u{4DBF}\u{4E00}-\u{9FFF}]/u;

function isCjk(ch: string): boolean {
  return CJK_CHAR.test(ch);
}

export function segmentCjkBigram(text: string): TokenSpan[] {
  return segmentByScriptNgram(text, isCjk, 2);
}
