/**
 * The Snowball German stemmer (https://snowballstem.org/algorithms/german/stemmer.html,
 * source: snowballstem/snowball's `algorithms/german.sbl`) -- the
 * affix-stripping algorithm docs/03-tokenization-i18n.md#stemming
 * commits to for languages with "a good affix-stripping stemmer".
 * Unlike English (`./stemmer-en.ts`, the classic 1980 Porter algorithm,
 * which predates Snowball), no pre-Snowball "classic" German stemmer
 * exists to port instead -- this module implements the Snowball rule
 * set directly. Verified against the standard 35,053-word public
 * reference vocabulary (`test/fixtures/german-{input,output}.txt`,
 * from snowballstem/snowball-data) with zero mismatches, not just a
 * hand-picked sample of example words.
 *
 * Shape, in order:
 *  1. prelude: mark a 'u'/'y' that sits between two vowels (e.g. the
 *     "u" in "bauen") as uppercase 'U'/'Y' so later steps don't treat
 *     it as an ordinary vowel or fold it as part of "ue"; then fold ß
 *     -> "ss" and the ae/oe/ue digraphs -> ä/ö/ü (protecting a 'u'
 *     immediately after 'q', e.g. "Quelle", from that last fold).
 *  2. mark_regions: compute R1/R2 boundaries (the same "first
 *     vowel-then-non-vowel transition, then again from there" recipe
 *     Porter2-family stemmers use), with a German-specific minimum:
 *     R1 can never start before index 3.
 *  3. four ordered suffix-stripping passes over R1/R2, each picking the
 *     single *longest* textually-matching alternative and evaluating
 *     only that one's own guard once -- if the guard fails, nothing is
 *     stripped, there's no falling back to try a shorter alternative
 *     (the same longest-match-wins semantics verified for English's
 *     applyRules(), and for the same reason: several of these
 *     alternatives are literal suffixes of each other, e.g. "es" of
 *     "s", so a naive first-match-in-list-order scan would misfire).
 *  4. postlude: undo the 'U'/'Y' marking back to 'u'/'y', and fold the
 *     umlauts (ä/ö/ü) down to their plain-vowel form (a/o/u) -- the
 *     final step, so "schön" and "schon" -- which
 *     docs/03-tokenization-i18n.md#case-folding--diacritics keeps
 *     distinct everywhere else (German's `foldDiacritics: false`) --
 *     still stem to the same term once suffix-stripping is involved,
 *     matching Snowball's own reference behavior.
 */

const VOWELS = new Set(["a", "e", "i", "o", "u", "y", "ä", "ö", "ü"]);
const S_ENDING = new Set([
  "b",
  "d",
  "f",
  "g",
  "h",
  "k",
  "l",
  "m",
  "n",
  "r",
  "t",
]);
const ST_ENDING = new Set(["b", "d", "f", "g", "h", "k", "l", "m", "n", "t"]);
const ET_ENDING = new Set([
  "d",
  "f",
  "g",
  "k",
  "l",
  "m",
  "n",
  "r",
  "s",
  "t",
  "U",
  "z",
  "ä",
]);
const ET_EXCEPTIONS = ["geordn", "intern", "plan", "tick", "tr"];
const POSTLUDE_MAP: Record<string, string> = {
  Y: "y",
  U: "u",
  ä: "a",
  ö: "o",
  ü: "u",
};

function isVowel(ch: string | undefined): boolean {
  return ch !== undefined && VOWELS.has(ch);
}

/** Marks a 'u'/'y' immediately between two vowels as 'U'/'Y' (prelude, step 1). */
function markSemivowels(word: string): string {
  const chars = [...word];
  for (let i = 1; i < chars.length - 1; i++) {
    const c = chars[i];
    if (
      (c === "u" || c === "y") &&
      isVowel(chars[i - 1]) &&
      isVowel(chars[i + 1])
    ) {
      chars[i] = c === "u" ? "U" : "Y";
    }
  }
  return chars.join("");
}

/** Folds ß -> "ss" and ae/oe/ue -> ä/ö/ü, protecting a 'u' right after 'q' (prelude, step 2). */
function foldDigraphs(word: string): string {
  let result = "";
  let i = 0;
  while (i < word.length) {
    const c = word[i];
    const two = word.slice(i, i + 2);
    if (c === "ß") {
      result += "ss";
      i += 1;
    } else if (two === "ae") {
      result += "ä";
      i += 2;
    } else if (two === "oe") {
      result += "ö";
      i += 2;
    } else if (two === "ue") {
      result += "ü";
      i += 2;
    } else if (two === "qu") {
      result += "qu";
      i += 2;
    } else {
      result += c;
      i += 1;
    }
  }
  return result;
}

/** "gopast v, gopast non-v" from `start`: index right after the first vowel-then-non-vowel transition, or `word.length` if either half never occurs. */
function findRegionStart(word: string, start: number): number {
  const len = word.length;
  let i = start;
  while (i < len && !isVowel(word[i])) i++;
  if (i >= len) return len;
  i++;
  while (i < len && isVowel(word[i])) i++;
  if (i >= len) return len;
  i++;
  return i;
}

function markRegions(word: string): { p1: number; p2: number } {
  const rawP1 = findRegionStart(word, 0);
  const x = word.length >= 3 ? 3 : 0;
  const p1 = rawP1 < x ? x : rawP1;
  const p2 = findRegionStart(word, rawP1);
  return { p1, p2 };
}

/**
 * Step 1 (R1): the longest of erinnen/erin/ern/lns/em/er/en/es/ln/e/s
 * that matches, textually, as a suffix starting at or after `p1`.
 */
function step1(word: string, p1: number): string {
  const suffixes = [
    "erinnen",
    "erin",
    "ern",
    "lns",
    "em",
    "er",
    "en",
    "es",
    "ln",
    "e",
    "s",
  ];
  let matched: string | undefined;
  let startIdx = -1;
  for (const suf of suffixes) {
    if (word.length >= suf.length && word.endsWith(suf)) {
      const idx = word.length - suf.length;
      if (idx >= p1) {
        matched = suf;
        startIdx = idx;
        break;
      }
    }
  }
  if (matched === undefined) return word;
  switch (matched) {
    case "em": {
      const before = word.slice(0, startIdx);
      return before.endsWith("syst") ? word : before;
    }
    case "ern":
    case "er":
    case "erin":
    case "erinnen":
      return word.slice(0, startIdx);
    case "e":
    case "en":
    case "es": {
      let result = word.slice(0, startIdx);
      if (result.endsWith("niss")) result = result.slice(0, -1);
      return result;
    }
    case "s": {
      const before = word.slice(0, startIdx);
      return S_ENDING.has(before[before.length - 1] ?? "") ? before : word;
    }
    case "ln":
    case "lns":
      return `${word.slice(0, startIdx)}l`;
    default:
      return word;
  }
}

/** Step 2 (R1): the longest of est/en/er/st/et that matches as a suffix starting at or after `p1`. */
function step2(word: string, p1: number): string {
  const suffixes = ["est", "en", "er", "st", "et"];
  let matched: string | undefined;
  let startIdx = -1;
  for (const suf of suffixes) {
    if (word.length >= suf.length && word.endsWith(suf)) {
      const idx = word.length - suf.length;
      if (idx >= p1) {
        matched = suf;
        startIdx = idx;
        break;
      }
    }
  }
  if (matched === undefined) return word;
  switch (matched) {
    case "en":
    case "er":
    case "est":
      return word.slice(0, startIdx);
    case "st": {
      const before = word.slice(0, startIdx);
      if (!ST_ENDING.has(before[before.length - 1] ?? "")) return word;
      // "hop 3": at least 4 characters (not just 3) must remain before
      // this "st" -- landing exactly on the region boundary after
      // hopping 3 further left isn't enough on its own, confirmed
      // against the reference vocabulary (e.g. "angst"/"einst"/"gehst"
      // must stay unstripped, while a 4-char stem like "darfst" ->
      // "darf" does strip).
      return before.length > 3 ? before : word;
    }
    case "et": {
      const before = word.slice(0, startIdx);
      if (!ET_ENDING.has(before[before.length - 1] ?? "")) return word;
      return ET_EXCEPTIONS.some((exc) => before.endsWith(exc)) ? word : before;
    }
    default:
      return word;
  }
}

/** Step 3 (R2): the longest of isch/lich/heit/keit/end/ung/ig/ik that matches as a suffix starting at or after `p2`. */
function step3(word: string, p1: number, p2: number): string {
  const suffixes = ["isch", "lich", "heit", "keit", "end", "ung", "ig", "ik"];
  let matched: string | undefined;
  let startIdx = -1;
  for (const suf of suffixes) {
    if (word.length >= suf.length && word.endsWith(suf)) {
      const idx = word.length - suf.length;
      if (idx >= p2) {
        matched = suf;
        startIdx = idx;
        break;
      }
    }
  }
  if (matched === undefined) return word;
  switch (matched) {
    case "end":
    case "ung": {
      let result = word.slice(0, startIdx);
      // Also strip a following "ig" (still within R2, not preceded by "e").
      if (result.endsWith("ig")) {
        const igStart = result.length - 2;
        const beforeIg = result.slice(0, igStart);
        if (igStart >= p2 && (beforeIg[beforeIg.length - 1] ?? "") !== "e") {
          result = beforeIg;
        }
      }
      return result;
    }
    case "ig":
    case "ik":
    case "isch": {
      const before = word.slice(0, startIdx);
      return (before[before.length - 1] ?? "") === "e" ? word : before;
    }
    case "lich":
    case "heit": {
      let result = word.slice(0, startIdx);
      for (const extra of ["er", "en"]) {
        if (result.endsWith(extra)) {
          const idx2 = result.length - extra.length;
          if (idx2 >= p1) result = result.slice(0, idx2);
          break;
        }
      }
      return result;
    }
    case "keit": {
      let result = word.slice(0, startIdx);
      for (const extra of ["lich", "ig"]) {
        if (result.endsWith(extra)) {
          const idx2 = result.length - extra.length;
          if (idx2 >= p2) result = result.slice(0, idx2);
          break;
        }
      }
      return result;
    }
    default:
      return word;
  }
}

/** Step 4 (no region restriction): a trailing "'sch"/"'s"/"'" -- English-style possessives/adjectival forms occasionally seen on loanwords and names -- stripped only when at least 2 characters remain before it. */
function step4(word: string): string {
  const suffixes = ["'sch", "'s", "'"];
  for (const suf of suffixes) {
    if (word.length >= suf.length && word.endsWith(suf)) {
      const before = word.slice(0, word.length - suf.length);
      return before.length >= 2 ? before : word;
    }
  }
  return word;
}

function postlude(word: string): string {
  let result = "";
  for (const c of word) {
    result += POSTLUDE_MAP[c] ?? c;
  }
  return result;
}

export function stemGerman(word: string): string {
  if (word.length === 0) return word;
  let w = foldDigraphs(markSemivowels(word));
  const { p1, p2 } = markRegions(w);
  w = step1(w, p1);
  w = step2(w, p1);
  w = step3(w, p1, p2);
  w = step4(w);
  return postlude(w);
}
