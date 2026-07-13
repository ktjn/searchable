import { describe, expect, it } from "vitest";
import { stemNorwegian } from "../src/stemmer-no.js";
import {
  collectStemMismatches,
  readSnowballFixture,
} from "./snowball-fixture.js";

describe("stemNorwegian", () => {
  it("applies Bokmål and Nynorsk suffix rules", () => {
    expect(stemNorwegian("heter")).toBe("het");
    expect(stemNorwegian("husene")).toBe("hus");
    expect(stemNorwegian("aktørane")).toBe("aktør");
    expect(stemNorwegian("løst")).toBe("løst");
  });

  it("matches the complete Snowball Norwegian reference vocabulary", () => {
    const { words, stems } = readSnowballFixture("norwegian");
    expect(words).toHaveLength(stems.length);
    expect(words.length).toBeGreaterThan(20_000);

    const mismatches = collectStemMismatches(words, stems, stemNorwegian);
    expect(mismatches.slice(0, 20)).toEqual([]);
    expect(mismatches).toHaveLength(0);
  });
});
