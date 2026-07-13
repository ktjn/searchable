import { describe, expect, it } from "vitest";
import { stemSwedish } from "../src/stemmer-sv.js";
import {
  collectStemMismatches,
  readSnowballFixture,
} from "./snowball-fixture.js";

describe("stemSwedish", () => {
  it("applies Swedish suffix and consonant rules", () => {
    expect(stemSwedish("husets")).toBe("hus");
    expect(stemSwedish("affärerna")).toBe("affär");
    expect(stemSwedish("fullt")).toBe("fullt");
  });

  it("matches the complete Snowball Swedish reference vocabulary", () => {
    const { words, stems } = readSnowballFixture("swedish");
    expect(words).toHaveLength(stems.length);
    expect(words.length).toBeGreaterThan(30_000);

    const mismatches = collectStemMismatches(words, stems, stemSwedish);
    expect(mismatches.slice(0, 20)).toEqual([]);
    expect(mismatches).toHaveLength(0);
  });
});
