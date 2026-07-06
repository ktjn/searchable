import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stemGerman } from "../src/stemmer-de.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("stemGerman", () => {
  it("folds ß to 'ss', ae/oe/ue digraphs to umlauts, and back to plain vowels at the end", () => {
    expect(stemGerman("abschluß")).toBe("abschluss");
    expect(stemGerman("abläßt")).toBe("ablasst");
  });

  it("does not fold 'ue' right after 'q' (protects Quelle-style words)", () => {
    expect(stemGerman("quelle")).toBe("quell");
  });

  it("strips a trailing apostrophe possessive/adjectival form (step 4)", () => {
    expect(stemGerman("einstein'sche")).toBe("einstein");
    expect(stemGerman("carlo's")).toBe("carlo");
  });

  it("matches every word/stem pair in the standard 35,053-word Snowball German reference vocabulary", () => {
    // From snowballstem/snowball-data (BSD-licensed), the standard
    // correctness oracle for a from-scratch Snowball German
    // implementation -- running the whole set (not a hand-picked
    // sample) is what caught real bugs while building the English
    // Porter stemmer earlier in this project, and is the same
    // verification standard applied here.
    const words = readFileSync(
      join(__dirname, "fixtures/german-input.txt"),
      "utf8",
    )
      .trim()
      .split("\n");
    const stems = readFileSync(
      join(__dirname, "fixtures/german-output.txt"),
      "utf8",
    )
      .trim()
      .split("\n");
    expect(words.length).toBe(stems.length);
    expect(words.length).toBeGreaterThan(30000);

    const mismatches: string[] = [];
    for (let i = 0; i < words.length; i++) {
      const word = words[i] as string;
      const expected = stems[i] as string;
      const actual = stemGerman(word);
      if (actual !== expected) {
        mismatches.push(`${word}: expected "${expected}", got "${actual}"`);
      }
    }
    expect(mismatches.slice(0, 20)).toEqual([]);
    expect(mismatches.length).toBe(0);
  });
});
