import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

export function readSnowballFixture(language: string): {
  words: string[];
  stems: string[];
} {
  const fixtureRoot = join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "spec",
    "fixtures",
    "snowball",
  );
  const readLines = (kind: "input" | "output") =>
    gunzipSync(readFileSync(join(fixtureRoot, `${language}-${kind}.txt.gz`)))
      .toString("utf8")
      .trim()
      .split(/\r?\n/);

  return { words: readLines("input"), stems: readLines("output") };
}

export function collectStemMismatches(
  words: readonly string[],
  stems: readonly string[],
  stem: (word: string) => string,
): string[] {
  const mismatches: string[] = [];
  for (let index = 0; index < words.length; index++) {
    const word = words[index] as string;
    const expected = stems[index] as string;
    const actual = stem(word);
    if (actual !== expected) {
      mismatches.push(`${word}: expected "${expected}", got "${actual}"`);
    }
  }
  return mismatches;
}
