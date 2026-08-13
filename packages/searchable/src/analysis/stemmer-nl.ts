const A = new Set(["a", "à", "á", "â", "ä"]);
const E = new Set(["e", "è", "é", "ê", "ë"]);
const I = new Set(["i", "ì", "í", "î", "ï"]);
const O = new Set(["o", "ò", "ó", "ô", "ö"]);
const U = new Set(["u", "ù", "ú", "û", "ü"]);
const AEIOU = new Set([...A, ...E, ...I, ...O, ...U]);
const AIOU = new Set([...A, ...I, ...O, ...U]);
const VOWELS = new Set([...AEIOU, "y"]);

function vowelLengthAt(word: string, index: number): number {
  if (word.slice(index, index + 2) === "ij") return 2;
  return VOWELS.has(word[index] ?? "") ? 1 : 0;
}

function measure(word: string): { p1: number; p2: number } {
  const regions: number[] = [];
  let index = 0;
  while (regions.length < 2 && index < word.length) {
    while (index < word.length && vowelLengthAt(word, index) === 0) index++;
    let vowels = 0;
    while (index < word.length) {
      const length = vowelLengthAt(word, index);
      if (length === 0) break;
      vowels++;
      index += length;
    }
    if (vowels === 0 || index >= word.length) break;
    index++;
    regions.push(index);
  }
  return { p1: regions[0] ?? word.length, p2: regions[1] ?? word.length };
}

function isC(prefix: string): boolean {
  if (prefix.length === 0 || prefix.endsWith("ij")) return false;
  return !VOWELS.has(prefix.at(-1) as string);
}

function isV(prefix: string): boolean {
  return prefix.endsWith("ij") || VOWELS.has(prefix.at(-1) ?? "");
}

function inRegion(word: string, suffix: string, region: number): boolean {
  return word.length - suffix.length >= region;
}

function longestSuffix(
  word: string,
  suffixes: readonly string[],
): string | undefined {
  let best: string | undefined;
  for (const suffix of suffixes) {
    if (
      word.endsWith(suffix) &&
      (best === undefined || suffix.length > best.length)
    ) {
      best = suffix;
    }
  }
  return best;
}

function lengthenV(word: string): string {
  if (word.length < 2) return word;
  const last = word.at(-1) as string;
  if (VOWELS.has(last) || last === "w" || last === "x") return word;
  const prefix = word.slice(0, -1);
  if (prefix.endsWith("eë")) return `${prefix.slice(0, -2)}eëe${last}`;
  if (prefix.endsWith("ië")) return `${prefix.slice(0, -2)}iee${last}`;

  const vowel = prefix.at(-1);
  if (vowel === undefined) return word;
  const before = prefix.slice(0, -1);
  if (A.has(vowel) || O.has(vowel) || U.has(vowel)) {
    if (before.length === 0 || !AEIOU.has(before.at(-1) as string)) {
      return `${prefix}${vowel}${last}`;
    }
  } else if (E.has(vowel) && vowel !== "ë") {
    if (before.length > 0 && AEIOU.has(before.at(-1) as string)) return word;
    const base = before.length === 0 ? before : before.slice(0, -1);
    if (AIOU.has(base.at(-1) ?? "")) return word;
    if (base.length === 1 && E.has(base)) return word;
    const skipped = base.slice(0, -1);
    if (
      skipped.length >= 2 &&
      AIOU.has(skipped.at(-1) as string) &&
      !AEIOU.has(skipped.at(-2) as string)
    ) {
      return word;
    }
    return `${prefix}${vowel}${last}`;
  }
  return word;
}

function step1(word: string, p1: number): { word: string; changed: boolean } {
  const suffix = longestSuffix(word, [
    "'s",
    "ies",
    "és",
    "aus",
    "nde",
    "en",
    "es",
    "s",
  ]);
  if (suffix === undefined) return { word, changed: false };
  const prefix = word.slice(0, -suffix.length);
  switch (suffix) {
    case "'s":
      return { word: prefix, changed: true };
    case "s":
      if (!inRegion(word, suffix, p1) || !isC(prefix))
        return { word, changed: false };
      if (prefix.endsWith("t") && prefix.length - 1 >= p1)
        return { word, changed: false };
      return { word: prefix, changed: true };
    case "ies":
      return inRegion(word, suffix, p1)
        ? { word: `${prefix}ie`, changed: true }
        : { word, changed: false };
    case "es": {
      if (
        prefix.endsWith("ar") &&
        prefix.length - 2 >= p1 &&
        isC(prefix.slice(0, -2))
      ) {
        return { word: lengthenV(prefix), changed: true };
      }
      if (
        prefix.endsWith("er") &&
        prefix.length - 2 >= p1 &&
        isC(prefix.slice(0, -2))
      ) {
        return { word: prefix, changed: true };
      }
      return inRegion(word, suffix, p1) && isC(prefix)
        ? { word: `${prefix}e`, changed: true }
        : { word, changed: false };
    }
    case "és":
      return inRegion(word, suffix, p1)
        ? { word: `${prefix}é`, changed: true }
        : { word, changed: false };
    case "aus":
      return inRegion(word, suffix, p1) && isV(prefix)
        ? { word: `${prefix}au`, changed: true }
        : { word, changed: false };
    case "en": {
      if (prefix.endsWith("hed") && prefix.length - 3 >= p1) {
        return { word: `${prefix.slice(0, -3)}heid`, changed: true };
      }
      if (prefix.endsWith("nd")) return { word: prefix, changed: true };
      if (
        prefix.endsWith("d") &&
        prefix.length - 1 >= p1 &&
        isC(prefix.slice(0, -1))
      ) {
        return { word: prefix.slice(0, -1), changed: true };
      }
      if (
        (prefix.endsWith("i") || prefix.endsWith("j")) &&
        isV(prefix.slice(0, -1))
      ) {
        return { word: prefix, changed: true };
      }
      return inRegion(word, suffix, p1) && isC(prefix)
        ? { word: lengthenV(prefix), changed: true }
        : { word, changed: false };
    }
    case "nde":
      return { word: `${prefix}nd`, changed: true };
  }
  return { word, changed: false };
}

function step2(word: string, p1: number): { word: string; changed: boolean } {
  const suffix = longestSuffix(word, [
    "lijke",
    "ische",
    "ieve",
    "ene",
    "je",
    "ge",
    "de",
    "te",
    "se",
    "re",
    "le",
  ]);
  if (suffix === undefined) return { word, changed: false };
  let prefix = word.slice(0, -suffix.length);
  if (suffix === "je") {
    if (prefix.endsWith("'t"))
      return { word: prefix.slice(0, -2), changed: true };
    if (
      prefix.endsWith("et") &&
      prefix.length - 2 >= p1 &&
      isC(prefix.slice(0, -2))
    ) {
      return { word: prefix.slice(0, -2), changed: true };
    }
    if (prefix.endsWith("rnt"))
      return { word: `${prefix.slice(0, -3)}rn`, changed: true };
    if (
      prefix.endsWith("t") &&
      prefix.length - 1 >= p1 &&
      isV(prefix.slice(0, -2))
    ) {
      return { word: prefix.slice(0, -1), changed: true };
    }
    if (prefix.endsWith("ink"))
      return { word: `${prefix.slice(0, -3)}ing`, changed: true };
    if (prefix.endsWith("mp"))
      return { word: `${prefix.slice(0, -2)}m`, changed: true };
    if (prefix.endsWith("'") && prefix.length - 1 >= p1)
      return { word: prefix.slice(0, -1), changed: true };
    return inRegion(word, suffix, p1) && isC(prefix)
      ? { word: prefix, changed: true }
      : { word, changed: false };
  }
  if (!inRegion(word, suffix, p1)) return { word, changed: false };
  switch (suffix) {
    case "ge":
      return { word: `${prefix}g`, changed: true };
    case "lijke":
      return { word: `${prefix}lijk`, changed: true };
    case "ische":
      return { word: `${prefix}isch`, changed: true };
    case "de":
      return isC(prefix)
        ? { word: prefix, changed: true }
        : { word, changed: false };
    case "te":
      return { word: `${prefix}t`, changed: true };
    case "se":
      return { word: `${prefix}s`, changed: true };
    case "re":
      return { word: `${prefix}r`, changed: true };
    case "le":
      prefix += "l";
      return { word: lengthenV(prefix), changed: true };
    case "ene":
      if (!isC(prefix)) return { word, changed: false };
      return { word: lengthenV(`${prefix}en`), changed: true };
    case "ieve":
      return isC(prefix)
        ? { word: `${prefix}ief`, changed: true }
        : { word, changed: false };
  }
  return { word, changed: false };
}

function step3(
  word: string,
  p1: number,
  p2: number,
): { word: string; changed: boolean } {
  const suffix = longestSuffix(word, [
    "iteit",
    "isme",
    "erij",
    "arij",
    "heid",
    "ster",
    "rder",
    "atie",
    "ing",
    "sel",
    "fie",
    "gie",
    "tst",
    "dst",
  ]);
  if (suffix === undefined) return { word, changed: false };
  const prefix = word.slice(0, -suffix.length);
  switch (suffix) {
    case "atie":
      return inRegion(word, suffix, p1)
        ? { word: `${prefix}eer`, changed: true }
        : { word, changed: false };
    case "iteit":
      return inRegion(word, suffix, p1)
        ? { word: lengthenV(prefix), changed: true }
        : { word, changed: false };
    case "heid":
    case "sel":
    case "ster":
      return inRegion(word, suffix, p1)
        ? { word: prefix, changed: true }
        : { word, changed: false };
    case "rder":
      return { word: `${prefix}r`, changed: true };
    case "ing":
    case "isme":
    case "erij":
      if (prefix.endsWith("ild")) return { word: `${prefix}er`, changed: true };
      return inRegion(word, suffix, p1)
        ? { word: lengthenV(prefix), changed: true }
        : { word, changed: false };
    case "arij":
      return inRegion(word, suffix, p1) && isC(prefix)
        ? { word: `${prefix}aar`, changed: true }
        : { word, changed: false };
    case "fie":
      return inRegion(word, suffix, p2)
        ? { word: lengthenV(`${prefix}f`), changed: true }
        : { word, changed: false };
    case "gie":
      return inRegion(word, suffix, p2)
        ? { word: lengthenV(`${prefix}g`), changed: true }
        : { word, changed: false };
    case "tst":
      return inRegion(word, suffix, p1) && isC(prefix)
        ? { word: `${prefix}t`, changed: true }
        : { word, changed: false };
    case "dst":
      return inRegion(word, suffix, p1) && isC(prefix)
        ? { word: `${prefix}d`, changed: true }
        : { word, changed: false };
  }
  return { word, changed: false };
}

function step4(word: string, p1: number): { word: string; changed: boolean } {
  const first = longestSuffix(word, [
    "achtiger",
    "achtigst",
    "eriger",
    "erigst",
    "ioneel",
    "lijker",
    "lijkst",
    "achtig",
    "atief",
    "baar",
    "naar",
    "laar",
    "raar",
    "tant",
    "erig",
    "end",
  ]);
  if (first !== undefined && inRegion(word, first, p1)) {
    const prefix = word.slice(0, -first.length);
    switch (first) {
      case "ioneel":
        return { word: `${prefix}ie`, changed: true };
      case "atief":
        return { word: `${prefix}eer`, changed: true };
      case "baar":
        return { word: prefix, changed: true };
      case "naar":
        if (isV(prefix)) return { word: `${prefix}n`, changed: true };
        break;
      case "laar":
        if (isV(prefix)) return { word: `${prefix}l`, changed: true };
        break;
      case "raar":
        if (isV(prefix)) return { word: `${prefix}r`, changed: true };
        break;
      case "tant":
        return { word: `${prefix}teer`, changed: true };
      case "lijker":
      case "lijkst":
        return { word: `${prefix}lijk`, changed: true };
      case "achtig":
      case "achtiger":
      case "achtigst":
        return { word: prefix, changed: true };
      case "erig":
      case "eriger":
      case "erigst":
      case "end":
        if (isC(prefix)) return { word: lengthenV(prefix), changed: true };
        break;
    }
  }
  const second = longestSuffix(word, ["iger", "igst", "ig"]);
  if (second === undefined || !inRegion(word, second, p1))
    return { word, changed: false };
  const prefix = word.slice(0, -second.length);
  if (prefix === "inn" || !isC(prefix)) return { word, changed: false };
  return { word: lengthenV(prefix), changed: true };
}

function validGeAt(word: string, index: number): boolean {
  const rest = word.slice(index + 2);
  if (rest.length < 3) return false;
  let cursor = 0;
  while (cursor < rest.length && vowelLengthAt(rest, cursor) === 0) cursor++;
  if (cursor >= rest.length) return false;
  while (cursor < rest.length) {
    const length = vowelLengthAt(rest, cursor);
    if (length === 0) break;
    cursor += length;
  }
  return cursor < rest.length;
}

function removeGe(word: string, index: number): string {
  let result = word.slice(0, index) + word.slice(index + 2);
  const char = result[index];
  if (char === "ë" || char === "ï")
    result = `${result.slice(0, index)}${char === "ë" ? "e" : "i"}${result.slice(index + 1)}`;
  return result;
}

function removePrefixGe(word: string): { word: string; changed: boolean } {
  if (!word.startsWith("ge") || !validGeAt(word, 0))
    return { word, changed: false };
  const rest = word.slice(2);
  if (
    rest.startsWith("eft") ||
    (rest.startsWith("val") && !rest.startsWith("vali")) ||
    rest.startsWith("vaa") ||
    rest.startsWith("vare")
  ) {
    return { word, changed: false };
  }
  return { word: removeGe(word, 0), changed: true };
}

function removeInfixGe(word: string): { word: string; changed: boolean } {
  const index = word.indexOf("ge", 1);
  return index >= 0 && validGeAt(word, index)
    ? { word: removeGe(word, index), changed: true }
    : { word, changed: false };
}

function step1c(word: string, p1: number): string {
  if (word.endsWith("d") && word.length - 1 >= p1 && isC(word.slice(0, -1))) {
    const prefix = word.slice(0, -1);
    if (prefix.endsWith("n") && prefix.length - 1 >= p1) return word;
    return prefix === "in" ? "inn" : prefix;
  }
  if (word.endsWith("t") && word.length - 1 >= p1 && isC(word.slice(0, -1))) {
    const prefix = word.slice(0, -1);
    if ((prefix.endsWith("h") && prefix.length - 1 >= p1) || prefix === "en")
      return word;
    return prefix;
  }
  return word;
}

function step7(word: string): { word: string; changed: boolean } {
  for (const suffix of ["kt", "ft", "pt"] as const) {
    if (word.endsWith(suffix))
      return { word: word.slice(0, -1), changed: true };
  }
  return { word, changed: false };
}

function step6(word: string): string {
  const pair = word.slice(-2);
  if (/^([bcdfghjklmnpqrstvwxyz])\1$/u.test(pair)) {
    if (pair === "nn" && word === "inn") return word;
    return word.slice(0, -1);
  }
  if (word.endsWith("v")) return `${word.slice(0, -1)}f`;
  if (word.endsWith("z")) return `${word.slice(0, -1)}s`;
  return word;
}

/** Snowball 3 Dutch stemmer, verified against snowball-data. */
export function stemDutch(word: string): string {
  if (word.length === 0) return word;
  let regions = measure(word);
  let result = word;
  let stemmed = false;
  for (const step of [
    () => step1(result, regions.p1),
    () => step2(result, regions.p1),
    () => step3(result, regions.p1, regions.p2),
    () => step4(result, regions.p1),
  ]) {
    const outcome = step();
    result = outcome.word;
    stemmed ||= outcome.changed;
  }
  const prefixGe = removePrefixGe(result);
  if (prefixGe.changed) {
    result = prefixGe.word;
    regions = measure(result);
    result = step1c(result, regions.p1);
    stemmed = true;
  }
  const infixGe = removeInfixGe(result);
  if (infixGe.changed) {
    result = infixGe.word;
    regions = measure(result);
    result = step1c(result, regions.p1);
    stemmed = true;
  }
  const seven = step7(result);
  result = seven.word;
  stemmed ||= seven.changed;
  return stemmed ? step6(result) : result;
}
