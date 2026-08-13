/**
 * Trigram (n-gram) fallback segmentation for Thai/Khmer/Lao text
 * (docs/guides/internationalization.md#segmentation): none of these scripts use
 * spaces between words, and dictionary-based word segmentation isn't
 * reliably available across every environment this runtime targets, so
 * — same reasoning and same tradeoff as `./segment-cjk.ts`'s bigram CJK
 * fallback — this indexes overlapping n-character windows instead of
 * real word boundaries, guaranteeing correct substring matching without
 * a bundled dictionary.
 *
 * Width 3, not 2: unlike a single Han/kana character (already a dense
 * semantic unit on its own), a single Thai/Khmer/Lao codepoint is often
 * just one letter or one combining vowel/tone sign — a bigram window
 * would frequently split a word's shortest meaningful unit (e.g. a
 * consonant-plus-vowel-sign pair) across two overlapping spans instead
 * of capturing it in one, so a 3-character window is the better match
 * for this script family's finer-grained letter/mark inventory.
 *
 * Iterates by Unicode code point (not grapheme cluster), same as
 * `./segment-cjk.ts` and consistent with the rest of this codebase —
 * a base consonant and its combining vowel/tone marks (all in the same
 * Unicode block for these scripts) end up as separate array elements
 * that a 3-wide window naturally tends to re-group, without needing
 * full grapheme-cluster segmentation.
 */

import type { TokenSpan } from "./language-profile.js";
import { segmentByScriptNgram } from "./segment-ngram.js";

// Thai (U+0E00-0E7F) + Lao (U+0E80-0EFF), a contiguous pair of blocks,
// plus Khmer (U+1780-17FF) -- covers base letters, vowel signs, and
// tone/diacritic marks for all three scripts.
const SEA_CHAR = /[\u{0E00}-\u{0EFF}\u{1780}-\u{17FF}]/u;

function isSea(ch: string): boolean {
  return SEA_CHAR.test(ch);
}

export function segmentSeaTrigram(text: string): TokenSpan[] {
  return segmentByScriptNgram(text, isSea, 3);
}
