import { describe, expect, it } from "vitest";
import { BASELINE_CONFIG } from "../src/config.js";
import {
  BENCHMARK_QUERIES,
  assertExpectedResult,
  createWorkload,
} from "../src/workload.js";

describe("CMS benchmark workload", () => {
  it("has six fixed correctness-checked query classes", () => {
    expect(BENCHMARK_QUERIES.map(({ id }) => id)).toEqual([
      "single-term",
      "multi-term",
      "prefix",
      "no-match",
      "filtered",
      "faceted",
    ]);
  });

  it("generates a deterministic CMS-2k identity", () => {
    const left = createWorkload(BASELINE_CONFIG);
    const right = createWorkload(BASELINE_CONFIG);
    expect(left.documents).toHaveLength(2006);
    expect(left.corpusHash).toMatch(/^[a-f0-9]{64}$/);
    expect(left.querySetHash).toMatch(/^[a-f0-9]{64}$/);
    expect(right.corpusHash).toBe(left.corpusHash);
    expect(right.querySetHash).toBe(left.querySetHash);
  });

  it("rejects an incorrect timed result", () => {
    expect(() =>
      assertExpectedResult(BENCHMARK_QUERIES[0]!, {
        hits: [],
        totalHits: 0,
        language: "en",
      }),
    ).toThrow(/single-term/);
  });
});
