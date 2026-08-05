/**
 * Deterministic, dependency-free language detection (docs/guides/internationalization.md,
 * docs/project/roadmap.md's "Auto language detection accuracy" open question) --
 * used as a fallback when a source document declares no `<html lang>`
 * (the Python port drives that at index time in
 * `python/searchable-indexer/src/searchable_indexer/extract.py`; this
 * TypeScript module exists for cross-language parity and direct query-time
 * use), never as a replacement for explicit
 * language tagging, which is always preferred when present. Deliberately
 * not a bundled ML model: the roadmap's own open question is "how much
 * bundled model size is worth it... vs. just requiring explicit `language`
 * tagging", and this resolves that for the common case at zero bundle
 * cost -- script-range detection for CJK and Thai/Khmer/Lao (unambiguous,
 * no data table needed, each occupies its own non-overlapping Unicode
 * block) plus a small curated function-word list for the Latin-script
 * profiles that actually exist today (English, German). A language this
 * module has no heuristic for (a hypothetical future Latin-script
 * LanguageProfile with no word list added here) is simply never detected
 * -- callers keep falling back to `defaultLanguage`, exactly as if this
 * function didn't exist, not a regression.
 */

const HIRAGANA_KATAKANA = /[぀-ヿ]/u;
const HAN = /[㐀-䶿一-鿿]/u;
const THAI = /[\u{0E00}-\u{0E7F}]/u;
const LAO = /[\u{0E80}-\u{0EFF}]/u;
const KHMER = /[\u{1780}-\u{17FF}]/u;
const LETTER = /\p{L}/u;

/**
 * Fraction of "letter-ish" characters that must be a given script before
 * this module trusts a script-based classification over Latin scoring --
 * guards against one stray non-Latin character in an otherwise-Latin
 * page (e.g. a brand name) triggering a false script-based verdict.
 */
const SCRIPT_THRESHOLD = 0.3;

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
  sv: new Set(["och", "är", "att", "inte", "också", "detta"]),
  nl: new Set(["het", "een", "van", "niet", "zijn", "wij"]),
  nb: new Set(["ikke", "jeg", "hva", "også", "hvordan", "hvem"]),
  nn: new Set(["ikkje", "eg", "kva", "òg", "korleis", "kven"]),
};

function countScriptChars(text: string): {
  han: number;
  kana: number;
  thai: number;
  lao: number;
  khmer: number;
  letters: number;
} {
  let han = 0;
  let kana = 0;
  let thai = 0;
  let lao = 0;
  let khmer = 0;
  let letters = 0;
  for (const ch of text) {
    if (!LETTER.test(ch)) continue;
    letters++;
    if (HIRAGANA_KATAKANA.test(ch)) kana++;
    else if (HAN.test(ch)) han++;
    else if (THAI.test(ch)) thai++;
    else if (LAO.test(ch)) lao++;
    else if (KHMER.test(ch)) khmer++;
  }
  return { han, kana, thai, lao, khmer, letters };
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
  const { han, kana, thai, lao, khmer, letters } = countScriptChars(text);
  if (letters > 0) {
    if ((han + kana) / letters >= SCRIPT_THRESHOLD) {
      const cjkCode = kana > 0 ? "ja" : "zh";
      return candidates.has(cjkCode) ? cjkCode : undefined;
    }
    if (thai / letters >= SCRIPT_THRESHOLD) {
      return candidates.has("th") ? "th" : undefined;
    }
    if (lao / letters >= SCRIPT_THRESHOLD) {
      return candidates.has("lo") ? "lo" : undefined;
    }
    if (khmer / letters >= SCRIPT_THRESHOLD) {
      return candidates.has("km") ? "km" : undefined;
    }
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
