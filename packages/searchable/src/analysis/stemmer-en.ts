/**
 * The classic Porter stemming algorithm (M.F. Porter, "An algorithm for
 * suffix stripping", 1980) for English -- the affix-stripping algorithm
 * docs/guides/internationalization.md#stemming commits to for languages with
 * "a good affix-stripping stemmer". Deliberately the original 1980
 * algorithm, not the later Snowball-framework "Porter2" English
 * stemmer (a distinct, incompatible rule set) -- the original is what
 * this module implements and what its test suite verifies against a
 * public 23,531-word reference vocabulary, and upgrading to Porter2 is
 * a separate, from-scratch rewrite rather than an incremental tweak.
 */

const VOWEL = /[aeiou]/;

/** A letter at `i` is a consonant unless it's a plain vowel, or `y` immediately after a vowel. */
function isConsonant(word: string, i: number): boolean {
  const c = word[i];
  if (c === undefined) return false;
  if (VOWEL.test(c)) return false;
  if (c !== "y") return true;
  return i === 0 || !isConsonant(word, i - 1);
}

/**
 * The word's consonant/vowel pattern collapses to [C](VC)^m[V]; `m` is
 * the number of VC repetitions, computed by scanning past the leading
 * consonant run (if any) and counting each vowel-run-to-consonant-run
 * transition.
 */
function measure(word: string): number {
  let i = 0;
  const n = word.length;
  while (i < n && isConsonant(word, i)) i++;
  let m = 0;
  while (i < n) {
    while (i < n && !isConsonant(word, i)) i++;
    if (i >= n) break;
    while (i < n && isConsonant(word, i)) i++;
    m++;
  }
  return m;
}

/** Whether `word` contains a vowel anywhere (the "*v*" condition). */
function hasVowel(word: string): boolean {
  for (let i = 0; i < word.length; i++) {
    if (!isConsonant(word, i)) return true;
  }
  return false;
}

/** Whether `word` ends in two identical consonants (the "*d" condition). */
function endsDoubleConsonant(word: string): boolean {
  const n = word.length;
  if (n < 2) return false;
  return (
    word[n - 1] === word[n - 2] &&
    isConsonant(word, n - 1) &&
    isConsonant(word, n - 2)
  );
}

/**
 * Whether `word` ends consonant-vowel-consonant with the final
 * consonant not w, x, or y (the "*o" condition) -- used to decide
 * whether a short CVC stem like "hop"/"trap" needs a trailing `e`
 * restored after suffix removal.
 */
function endsCvc(word: string): boolean {
  const n = word.length;
  if (n < 3) return false;
  const last = word[n - 1] as string;
  return (
    isConsonant(word, n - 3) &&
    !isConsonant(word, n - 2) &&
    isConsonant(word, n - 1) &&
    last !== "w" &&
    last !== "x" &&
    last !== "y"
  );
}

interface Rule {
  suffix: string;
  replacement: string;
  /** Extra condition on the stem (the part before `suffix`), beyond the suffix match itself. */
  condition?: (stem: string) => boolean;
}

/**
 * Applies the rule for the *longest* suffix (in list order, so `rules`
 * must list any mutually-nesting suffixes -- e.g. "ement"/"ment"/"ent"
 * -- longest first) that textually matches `word`. Once that one rule
 * is found, its condition is checked exactly once: if it fails, `word`
 * is returned unchanged rather than falling through to try a shorter
 * nested suffix (e.g. a word ending "...ement" whose "ement" rule's
 * condition fails must not then be reinterpreted as ending in the
 * shorter "ent", even though it textually also matches).
 */
function applyRules(word: string, rules: Rule[]): string {
  for (const rule of rules) {
    if (!word.endsWith(rule.suffix)) continue;
    const stem = word.slice(0, word.length - rule.suffix.length);
    if (rule.condition && !rule.condition(stem)) return word;
    return stem + rule.replacement;
  }
  return word;
}

function step1a(word: string): string {
  return applyRules(word, [
    { suffix: "sses", replacement: "ss" },
    { suffix: "ies", replacement: "i" },
    { suffix: "ss", replacement: "ss" },
    { suffix: "s", replacement: "" },
  ]);
}

/** Post-processing shared by the `ed`/`ing` rules of step 1b once one of them fires. */
function restoreAfterStep1b(stem: string): string {
  if (stem.endsWith("at") || stem.endsWith("bl") || stem.endsWith("iz")) {
    return `${stem}e`;
  }
  if (endsDoubleConsonant(stem) && !/[lsz]$/.test(stem)) {
    return stem.slice(0, -1);
  }
  if (measure(stem) === 1 && endsCvc(stem)) {
    return `${stem}e`;
  }
  return stem;
}

function step1b(word: string): string {
  if (word.endsWith("eed")) {
    const stem = word.slice(0, -3);
    return measure(stem) > 0 ? `${stem}ee` : word;
  }
  for (const suffix of ["ed", "ing"]) {
    if (!word.endsWith(suffix)) continue;
    const stem = word.slice(0, word.length - suffix.length);
    if (!hasVowel(stem)) continue;
    return restoreAfterStep1b(stem);
  }
  return word;
}

function step1c(word: string): string {
  if (!word.endsWith("y")) return word;
  const stem = word.slice(0, -1);
  if (stem.length === 0 || !hasVowel(stem)) return word;
  return `${stem}i`;
}

const m0 = (stem: string) => measure(stem) > 0;

function step2(word: string): string {
  return applyRules(word, [
    { suffix: "ational", replacement: "ate", condition: m0 },
    { suffix: "tional", replacement: "tion", condition: m0 },
    { suffix: "enci", replacement: "ence", condition: m0 },
    { suffix: "anci", replacement: "ance", condition: m0 },
    { suffix: "izer", replacement: "ize", condition: m0 },
    { suffix: "bli", replacement: "ble", condition: m0 },
    { suffix: "alli", replacement: "al", condition: m0 },
    { suffix: "entli", replacement: "ent", condition: m0 },
    { suffix: "eli", replacement: "e", condition: m0 },
    { suffix: "ousli", replacement: "ous", condition: m0 },
    { suffix: "ization", replacement: "ize", condition: m0 },
    { suffix: "ation", replacement: "ate", condition: m0 },
    { suffix: "ator", replacement: "ate", condition: m0 },
    { suffix: "alism", replacement: "al", condition: m0 },
    { suffix: "iveness", replacement: "ive", condition: m0 },
    { suffix: "fulness", replacement: "ful", condition: m0 },
    { suffix: "ousness", replacement: "ous", condition: m0 },
    { suffix: "aliti", replacement: "al", condition: m0 },
    { suffix: "iviti", replacement: "ive", condition: m0 },
    { suffix: "biliti", replacement: "ble", condition: m0 },
    { suffix: "logi", replacement: "log", condition: m0 },
  ]);
}

function step3(word: string): string {
  return applyRules(word, [
    { suffix: "icate", replacement: "ic", condition: m0 },
    { suffix: "ative", replacement: "", condition: m0 },
    { suffix: "alize", replacement: "al", condition: m0 },
    { suffix: "iciti", replacement: "ic", condition: m0 },
    { suffix: "ical", replacement: "ic", condition: m0 },
    { suffix: "ful", replacement: "", condition: m0 },
    { suffix: "ness", replacement: "", condition: m0 },
  ]);
}

const m1 = (stem: string) => measure(stem) > 1;

function step4(word: string): string {
  return applyRules(word, [
    { suffix: "al", replacement: "", condition: m1 },
    { suffix: "ance", replacement: "", condition: m1 },
    { suffix: "ence", replacement: "", condition: m1 },
    { suffix: "er", replacement: "", condition: m1 },
    { suffix: "ic", replacement: "", condition: m1 },
    { suffix: "able", replacement: "", condition: m1 },
    { suffix: "ible", replacement: "", condition: m1 },
    { suffix: "ant", replacement: "", condition: m1 },
    { suffix: "ement", replacement: "", condition: m1 },
    { suffix: "ment", replacement: "", condition: m1 },
    { suffix: "ent", replacement: "", condition: m1 },
    {
      suffix: "ion",
      replacement: "",
      condition: (stem) =>
        m1(stem) && (stem.endsWith("s") || stem.endsWith("t")),
    },
    { suffix: "ou", replacement: "", condition: m1 },
    { suffix: "ism", replacement: "", condition: m1 },
    { suffix: "ate", replacement: "", condition: m1 },
    { suffix: "iti", replacement: "", condition: m1 },
    { suffix: "ous", replacement: "", condition: m1 },
    { suffix: "ive", replacement: "", condition: m1 },
    { suffix: "ize", replacement: "", condition: m1 },
  ]);
}

function step5a(word: string): string {
  if (!word.endsWith("e")) return word;
  const stem = word.slice(0, -1);
  const m = measure(stem);
  if (m > 1 || (m === 1 && !endsCvc(stem))) return stem;
  return word;
}

function step5b(word: string): string {
  if (word.endsWith("ll") && measure(word.slice(0, -1)) > 1) {
    return word.slice(0, -1);
  }
  return word;
}

/** Every rule above assumes plain a-z letters; anything else (diacritics, digits, other scripts) is returned unchanged rather than stemmed nonsensically. */
const ASCII_LETTERS_ONLY = /^[a-z]+$/;

/**
 * Stems an already-lowercased English word via the classic Porter
 * algorithm's five steps, applied in sequence. Words too short to
 * carry an inflectional suffix (len <= 2), or containing anything
 * outside plain a-z (an English profile doesn't fold diacritics, so an
 * accented loanword like "café" can reach here unmodified), are
 * returned unchanged, same as the reference algorithm's ASCII-only
 * scope.
 */
export function stemEnglish(word: string): string {
  if (word.length <= 2 || !ASCII_LETTERS_ONLY.test(word)) return word;
  let result = step1a(word);
  result = step1b(result);
  result = step1c(result);
  result = step2(result);
  result = step3(result);
  result = step4(result);
  result = step5a(result);
  result = step5b(result);
  return result;
}
