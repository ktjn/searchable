import { expect, it } from "vitest";
import { summarizeSamples } from "../src/statistics.js";

it("preserves samples and uses nearest-rank p50 and p95", () => {
  expect(summarizeSamples([10, 1, 9, 2, 8, 3, 7, 4, 6, 5])).toEqual({
    samples: [10, 1, 9, 2, 8, 3, 7, 4, 6, 5],
    p50: 5,
    p95: 10,
    min: 1,
    max: 10,
  });
});

it.each([[], [1, Number.NaN], [1, -1], [Number.POSITIVE_INFINITY]])(
  "rejects invalid samples %#",
  (samples) => expect(() => summarizeSamples(samples)).toThrow(),
);
