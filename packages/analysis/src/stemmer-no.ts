import {
  longestSuffixInRegion,
  markScandinavianRegion,
} from "./stemmer-scandinavian.js";

const VOWELS = new Set([
  "a",
  "e",
  "ê",
  "i",
  "o",
  "ò",
  "ó",
  "ô",
  "u",
  "y",
  "æ",
  "å",
  "ø",
]);
const S_ENDING = new Set([
  "b",
  "c",
  "d",
  "f",
  "g",
  "h",
  "j",
  "l",
  "m",
  "n",
  "o",
  "p",
  "t",
  "v",
  "y",
  "z",
]);
const MAIN_SUFFIXES = [
  "a",
  "e",
  "ede",
  "ande",
  "ende",
  "ane",
  "ene",
  "hetene",
  "en",
  "heten",
  "ar",
  "er",
  "heter",
  "as",
  "es",
  "edes",
  "endes",
  "enes",
  "hetenes",
  "ens",
  "hetens",
  "ets",
  "et",
  "het",
  "ast",
  "ers",
  "s",
  "erte",
  "ert",
];
const ERS_KEEP = [
  "amm",
  "ast",
  "ind",
  "kap",
  "kk",
  "lt",
  "nk",
  "omm",
  "pp",
  "v",
  "øst",
];
const ERS_DELETE = ["giv", "hav", "skap"];

function markNorwegianRegion(word: string): number {
  const apostrophe = word.indexOf("'");
  return apostrophe >= 0
    ? Math.max(3, apostrophe + 1)
    : markScandinavianRegion(word, VOWELS);
}

function validSEnding(prefix: string): boolean {
  const last = prefix.at(-1) ?? "";
  if (S_ENDING.has(last)) return true;
  if (last === "r") return prefix.at(-2) !== "e";
  if (last === "k") {
    const before = prefix.at(-2);
    return before !== undefined && !VOWELS.has(before);
  }
  return false;
}

function mainSuffix(word: string, p1: number): string {
  const suffix = longestSuffixInRegion(word, p1, MAIN_SUFFIXES);
  if (suffix === undefined) return word;
  const prefix = word.slice(0, -suffix.length);
  if (suffix === "ers") {
    if (ERS_DELETE.some((ending) => prefix.endsWith(ending))) return prefix;
    return ERS_KEEP.some((ending) => prefix.endsWith(ending)) ? word : prefix;
  }
  if (suffix === "s") return validSEnding(prefix) ? prefix : word;
  if (suffix === "erte" || suffix === "ert") return `${prefix}er`;
  return prefix;
}

function consonantPair(word: string, p1: number): string {
  const suffix = longestSuffixInRegion(word, p1, ["dt", "vt"]);
  return suffix === undefined ? word : word.slice(0, -1);
}

function otherSuffix(word: string, p1: number): string {
  const suffix = longestSuffixInRegion(word, p1, [
    "leg",
    "eleg",
    "ig",
    "eig",
    "lig",
    "elig",
    "els",
    "lov",
    "elov",
    "slov",
    "hetslov",
  ]);
  return suffix === undefined ? word : word.slice(0, -suffix.length);
}

/** Snowball Norwegian stemmer for Bokmål and Nynorsk. */
export function stemNorwegian(word: string): string {
  if (word.length === 0) return word;
  const p1 = markNorwegianRegion(word);
  let result = mainSuffix(word, p1);
  result = consonantPair(result, p1);
  result = otherSuffix(result, p1);
  return result.endsWith("'") ? result.slice(0, -1) : result;
}
