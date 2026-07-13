import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stemEnglish } from "../src/stemmer-en.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("stemEnglish", () => {
  it("leaves short words (<=2 chars) unchanged", () => {
    expect(stemEnglish("a")).toBe("a");
    expect(stemEnglish("is")).toBe("is");
  });

  it("leaves non-ASCII-letter input unchanged (accents, digits) rather than stemming nonsensically", () => {
    expect(stemEnglish("café")).toBe("café");
    expect(stemEnglish("2024")).toBe("2024");
  });

  it("strips plural/inflectional suffixes (step 1a/1b)", () => {
    expect(stemEnglish("caresses")).toBe("caress");
    expect(stemEnglish("ponies")).toBe("poni");
    expect(stemEnglish("ties")).toBe("ti");
    expect(stemEnglish("caress")).toBe("caress");
    expect(stemEnglish("cats")).toBe("cat");
    expect(stemEnglish("feed")).toBe("feed");
    expect(stemEnglish("agreed")).toBe("agre");
    expect(stemEnglish("plastered")).toBe("plaster");
    expect(stemEnglish("bled")).toBe("bled");
    expect(stemEnglish("motoring")).toBe("motor");
    expect(stemEnglish("sing")).toBe("sing");
    expect(stemEnglish("conflated")).toBe("conflat");
    expect(stemEnglish("troubled")).toBe("troubl");
    expect(stemEnglish("sized")).toBe("size");
    expect(stemEnglish("hopping")).toBe("hop");
    expect(stemEnglish("tanned")).toBe("tan");
    expect(stemEnglish("falling")).toBe("fall");
    expect(stemEnglish("hissing")).toBe("hiss");
    expect(stemEnglish("fizzed")).toBe("fizz");
    expect(stemEnglish("failing")).toBe("fail");
    expect(stemEnglish("filing")).toBe("file");
  });

  it("converts a consonant-preceded trailing y to i, only when the stem has a vowel (step 1c)", () => {
    expect(stemEnglish("happy")).toBe("happi");
    expect(stemEnglish("sky")).toBe("sky");
  });

  it("applies the derivational-suffix mappings of steps 2-3", () => {
    expect(stemEnglish("relational")).toBe("relat");
    expect(stemEnglish("conditional")).toBe("condit");
    expect(stemEnglish("rational")).toBe("ration");
    expect(stemEnglish("hesitanci")).toBe("hesit");
    expect(stemEnglish("digitizer")).toBe("digit");
    expect(stemEnglish("conformabli")).toBe("conform");
    expect(stemEnglish("radicalli")).toBe("radic");
    expect(stemEnglish("differentli")).toBe("differ");
    expect(stemEnglish("vileli")).toBe("vile");
    expect(stemEnglish("analogousli")).toBe("analog");
    expect(stemEnglish("vietnamization")).toBe("vietnam");
    expect(stemEnglish("predication")).toBe("predic");
    expect(stemEnglish("operator")).toBe("oper");
    expect(stemEnglish("feudalism")).toBe("feudal");
    expect(stemEnglish("decisiveness")).toBe("decis");
    expect(stemEnglish("hopefulness")).toBe("hope");
    expect(stemEnglish("callousness")).toBe("callous");
    expect(stemEnglish("formaliti")).toBe("formal");
    expect(stemEnglish("sensitiviti")).toBe("sensit");
    expect(stemEnglish("sensibiliti")).toBe("sensibl");
  });

  it("does not strip a longer nested suffix's shorter alternative when the longer one's condition fails (e.g. ement/ment/ent)", () => {
    // measure("agree") is 1, so neither "ement" (m>1) nor "ment" (m>1)
    // fires -- a naive implementation that falls through to the
    // shorter nested "ent" suffix would wrongly strip it anyway, since
    // measure("agreem") is 2. This is a real regression found while
    // building this stemmer, not a hypothetical.
    expect(stemEnglish("agreement")).toBe("agreement");
    expect(stemEnglish("argument")).toBe("argument");
    expect(stemEnglish("element")).toBe("element");
    expect(stemEnglish("implements")).toBe("implement");
  });

  it("uses bli->ble (not the original paper's abli->able) per the later errata, and adds logi->log", () => {
    // Also both real regressions caught by validating against the
    // reference vocabulary below, not assumed from the paper text.
    expect(stemEnglish("corruptibly")).toBe("corrupt");
    expect(stemEnglish("dumbly")).toBe("dumbl");
    expect(stemEnglish("apology")).toBe("apolog");
  });

  it("matches every word/stem pair in the canonical 23,531-word Porter reference vocabulary", () => {
    // From words/stemmer (MIT), https://github.com/words/stemmer --
    // itself a mirror of M.F. Porter's own reference test data
    // (voc.txt/output.txt), the standard correctness oracle for a
    // from-scratch classic-Porter implementation. Running the whole
    // set (not a hand-picked sample) is what caught both of the real
    // bugs the tests above document.
    const words = readFileSync(
      join(__dirname, "fixtures/porter-input.txt"),
      "utf8",
    )
      .trim()
      .split(/\r?\n/);
    const stems = readFileSync(
      join(__dirname, "fixtures/porter-output.txt"),
      "utf8",
    )
      .trim()
      .split(/\r?\n/);
    expect(words.length).toBe(stems.length);
    expect(words.length).toBeGreaterThan(20000);

    const mismatches: string[] = [];
    for (let i = 0; i < words.length; i++) {
      const word = words[i] as string;
      const expected = stems[i] as string;
      const actual = stemEnglish(word);
      if (actual !== expected) {
        mismatches.push(`${word}: expected "${expected}", got "${actual}"`);
      }
    }
    expect(mismatches.slice(0, 20)).toEqual([]);
    expect(mismatches.length).toBe(0);
  });
});
