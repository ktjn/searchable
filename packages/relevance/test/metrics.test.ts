import { describe, expect, it } from "vitest";
import {
  evaluateRanking,
  isZeroResult,
  ndcgAtK,
  precisionAtK,
  recallAtK,
  reciprocalRank,
} from "../src/metrics.js";

const judgments = { a: 3 as const, b: 2 as const, c: 1 as const, x: 0 as const };

describe("relevance metrics", () => {
  it("calculates reciprocal rank", () => {
    expect(reciprocalRank(["x", "b"], judgments)).toBe(0.5);
    expect(reciprocalRank(["x"], judgments)).toBe(0);
  });

  it("calculates precision and recall at a cutoff", () => {
    expect(precisionAtK(["a", "x"], judgments, 3)).toBeCloseTo(1 / 3);
    expect(recallAtK(["a", "x"], judgments, 2)).toBeCloseTo(1 / 3);
  });

  it("calculates graded nDCG", () => {
    expect(ndcgAtK(["b", "a"], judgments, 2)).toBeCloseTo(
      (3 + 7 / Math.log2(3)) / (7 + 3 / Math.log2(3)),
    );
  });

  it("recognizes zero-result rankings", () => {
    expect(isZeroResult([])).toBe(true);
    expect(isZeroResult(["a"])).toBe(false);
  });

  it("rejects duplicate result IDs and invalid cutoffs", () => {
    expect(() => evaluateRanking(["a", "a"], judgments, 5)).toThrow(
      /duplicate result id a/,
    );
    expect(() => precisionAtK([], judgments, 0)).toThrow(/positive integer/);
  });
});
