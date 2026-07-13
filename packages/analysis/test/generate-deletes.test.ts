import { describe, expect, it } from "vitest";
import { generateDeletes } from "../src/index.js";

describe("generateDeletes", () => {
  it("includes the term and every unique one-code-point deletion", () => {
    expect(new Set(generateDeletes("cat", 1))).toEqual(
      new Set(["cat", "at", "ct", "ca"]),
    );
  });

  it("walks deletion-of-deletion variants at edit distance two", () => {
    expect(new Set(generateDeletes("cat", 2))).toEqual(
      new Set(["cat", "at", "ct", "ca", "a", "t", "c"]),
    );
  });

  it("deletes Unicode code points without splitting surrogate pairs", () => {
    expect(new Set(generateDeletes("a😀", 1))).toEqual(
      new Set(["a😀", "😀", "a"]),
    );
  });

  it("deduplicates repeated-character variants", () => {
    expect(generateDeletes("aa", 1)).toEqual(["aa", "a"]);
  });
});
