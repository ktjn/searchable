import {
  longestSuffixInRegion,
  markScandinavianRegion,
} from "./stemmer-scandinavian.js";

const VOWELS = new Set(["a", "e", "i", "o", "u", "y", "å", "ä", "ö"]);
const S_ENDING = new Set([
  "b",
  "c",
  "d",
  "f",
  "g",
  "h",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "r",
  "t",
  "v",
  "y",
]);
const OST_ENDING = new Set(["i", "k", "l", "n", "p", "r", "t", "u", "v"]);
const ET_EXCEPTIONS = [
  "h",
  "iet",
  "uit",
  "fab",
  "cit",
  "dit",
  "alit",
  "ilit",
  "mit",
  "nit",
  "pit",
  "rit",
  "sit",
  "tit",
  "ivit",
  "kvit",
  "xit",
  "kom",
  "rak",
  "pak",
  "stak",
];
const MAIN_SUFFIXES = [
  "a",
  "arna",
  "erna",
  "heterna",
  "orna",
  "ad",
  "e",
  "ade",
  "ande",
  "arne",
  "are",
  "aste",
  "en",
  "anden",
  "aren",
  "heten",
  "ern",
  "ar",
  "er",
  "heter",
  "or",
  "as",
  "arnas",
  "ernas",
  "ornas",
  "es",
  "ades",
  "andes",
  "ens",
  "arens",
  "hetens",
  "erns",
  "at",
  "andet",
  "het",
  "ast",
  "s",
  "et",
];

function validEtPrefix(prefix: string): boolean {
  if (prefix.length < 3) return false;
  const last = prefix[prefix.length - 1] as string;
  const beforeLast = prefix[prefix.length - 2] as string;
  if (VOWELS.has(last) || !VOWELS.has(beforeLast)) return false;
  return !ET_EXCEPTIONS.some((suffix) => prefix.endsWith(suffix));
}

function mainSuffix(word: string, p1: number): string {
  const suffix = longestSuffixInRegion(word, p1, MAIN_SUFFIXES);
  if (suffix === undefined) return word;
  if (suffix === "s") {
    const beforeS = word.slice(0, -1);
    if (beforeS.endsWith("et") && validEtPrefix(beforeS.slice(0, -2))) {
      return beforeS.slice(0, -2);
    }
    return S_ENDING.has(beforeS.at(-1) ?? "") ? beforeS : word;
  }
  if (suffix === "et") {
    const prefix = word.slice(0, -2);
    return validEtPrefix(prefix) ? prefix : word;
  }
  return word.slice(0, -suffix.length);
}

function consonantPair(word: string, p1: number): string {
  const suffix = longestSuffixInRegion(word, p1, [
    "dd",
    "gd",
    "nn",
    "dt",
    "gt",
    "kt",
    "tt",
  ]);
  return suffix === undefined ? word : word.slice(0, -1);
}

function otherSuffix(word: string, p1: number): string {
  const suffix = longestSuffixInRegion(word, p1, [
    "lig",
    "ig",
    "els",
    "öst",
    "fullt",
  ]);
  if (suffix === undefined) return word;
  if (suffix === "fullt") return `${word.slice(0, -suffix.length)}full`;
  if (suffix === "öst") {
    const prefix = word.slice(0, -suffix.length);
    return OST_ENDING.has(prefix.at(-1) ?? "") ? `${prefix}ös` : word;
  }
  return word.slice(0, -suffix.length);
}

/** Snowball Swedish stemmer, verified against snowball-data. */
export function stemSwedish(word: string): string {
  if (word.length === 0) return word;
  const p1 = markScandinavianRegion(word, VOWELS);
  return otherSuffix(consonantPair(mainSuffix(word, p1), p1), p1);
}
