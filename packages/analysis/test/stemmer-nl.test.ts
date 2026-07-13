import { describe, expect, it } from "vitest";
import { stemDutch } from "../src/stemmer-nl.js";
import {
  collectStemMismatches,
  readSnowballFixture,
} from "./snowball-fixture.js";

describe("stemDutch", () => {
  it("applies Dutch plural, heden, undoubling, and derivational rules", () => {
    expect(stemDutch("huizen")).toBe("huis");
    expect(stemDutch("heden")).toBe("heed");
    expect(stemDutch("paarden")).toBe("paar");
    expect(stemDutch("eenvoudig")).toBe("eenvoud");
    expect(stemDutch("cafés")).toBe("café");
  });

  it("matches the complete Snowball Dutch reference vocabulary", () => {
    const { words, stems } = readSnowballFixture("dutch");
    expect(words).toHaveLength(stems.length);
    expect(words.length).toBeGreaterThan(45_000);

    const mismatches = collectStemMismatches(words, stems, stemDutch);
    expect(mismatches.slice(0, 20)).toEqual([]);
    expect(mismatches).toHaveLength(0);
  });
});
