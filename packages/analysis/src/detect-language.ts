/**
 * Deterministic, dependency-free language detection (docs/03-tokenization-i18n.md,
 * docs/09-roadmap.md's "Auto language detection accuracy" open question) --
 * used as a fallback when a source document declares no `<html lang>`
 * (`packages/indexer/src/extract.ts`), not as a replacement for explicit
 * language tagging, which is always preferred when present. Deliberately
 * not a bundled ML model: the roadmap's own open question is "how much
 * bundled model size is worth it... vs. just requiring explicit `language`
 * tagging", and this resolves that for the common case at zero bundle
 * cost -- script-range detection for CJK (unambiguous, no data table
 * needed) plus a small curated function-word list for the Latin-script
 * profiles that actually exist today (English, German). A language this
 * module has no heuristic for (a hypothetical future Latin-script
 * LanguageProfile with no word list added here) is simply never detected
 * -- callers keep falling back to `defaultLanguage`, exactly as if this
 * function didn't exist, not a regression.
 */

const HIRAGANA_KATAKANA = /[぀-ヿ]/u;
const HAN = /[㐀-䶿一-鿿]/u;
const LETTER = /\p{L}/u;

/**
 * Fraction of "letter-ish" characters that must be CJK-script before this
 * module trusts a script-based classification over Latin scoring --
 * guards against one stray Han character in an otherwise-Latin page
 * (e.g. a brand name) triggering a false "this is Chinese" verdict.
 */
const CJK_SCRIPT_THRESHOLD = 0.3;

/**
 * Small, curated, unambiguous function-word lists -- purely a detection
 * signal, deliberately independent of `LanguageProfile.stopwords` (which
 * stays empty everywhere today, "no stopword removal yet"; see
 * language-profile.ts). Every word here is exclusive to its language
 * among this list, so simple counting (not a trained frequency model) is
 * enough to separate them.
 */
const LATIN_MARKER_WORDS: Record<string, ReadonlySet<string>> = {
  en: new Set([
    "the",
    "and",
    "of",
    "to",
    "is",
    "in",
    "that",
    "for",
    "with",
    "as",
    "was",
    "are",
    "this",
    "have",
    "from",
    "by",
    "an",
    "be",
    "or",
    "on",
  ]),
  de: new Set([
    "der",
    "die",
    "das",
    "und",
    "ist",
    "nicht",
    "mit",
    "für",
    "auf",
    "sich",
    "den",
    "dem",
    "eine",
    "einen",
    "ein",
    "zu",
    "von",
    "im",
    "auch",
    "sind",
  ]),
};

function countCjkChars(text: string): {
  han: number;
  kana: number;
  letters: number;
} {
  let han = 0;
  let kana = 0;
  let letters = 0;
  for (const ch of text) {
    if (!LETTER.test(ch)) continue;
    letters++;
    if (HIRAGANA_KATAKANA.test(ch)) kana++;
    else if (HAN.test(ch)) han++;
  }
  return { han, kana, letters };
}

/** Counts occurrences of `words` (whole-word, case-insensitive) in `text`. */
function countMarkerWords(text: string, words: ReadonlySet<string>): number {
  let count = 0;
  for (const token of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
    if (words.has(token)) count++;
  }
  return count;
}

/**
 * Detects `text`'s language among `candidateCodes` (typically every
 * language a manifest actually registers a `LanguageProfile` for),
 * returning `undefined` when no signal is confident enough to prefer
 * one candidate over the others -- callers should fall back to their
 * own `defaultLanguage` in that case, exactly as `extractDocument()`
 * does when no `<html lang>` attribute is present at all.
 */
export function detectLanguage(
  text: string,
  candidateCodes: readonly string[],
): string | undefined {
  const candidates = new Set(candidateCodes);
  const { han, kana, letters } = countCjkChars(text);
  if (letters > 0 && (han + kana) / letters >= CJK_SCRIPT_THRESHOLD) {
    const cjkCode = kana > 0 ? "ja" : "zh";
    return candidates.has(cjkCode) ? cjkCode : undefined;
  }

  let bestCode: string | undefined;
  let bestCount = 0;
  let tied = false;
  for (const code of candidates) {
    const words = LATIN_MARKER_WORDS[code];
    if (!words) continue;
    const count = countMarkerWords(text, words);
    if (count === 0) continue;
    if (count > bestCount) {
      bestCode = code;
      bestCount = count;
      tied = false;
    } else if (count === bestCount) {
      tied = true;
    }
  }
  return tied ? undefined : bestCode;
}
