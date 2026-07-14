import type { SampleSummary } from "./types.js";

function nearestRank(sorted: readonly number[], percentile: number): number {
  const index = Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1);
  const value = sorted[index];
  if (value === undefined) throw new Error("sample set must be non-empty");
  return value;
}

export function summarizeSamples(samples: readonly number[]): SampleSummary {
  if (
    samples.length === 0 ||
    samples.some((sample) => !Number.isFinite(sample) || sample < 0)
  ) {
    throw new Error("samples must contain finite non-negative values");
  }

  const sorted = [...samples].sort((left, right) => left - right);
  return {
    samples: [...samples],
    p50: nearestRank(sorted, 50),
    p95: nearestRank(sorted, 95),
    min: sorted[0] as number,
    max: sorted.at(-1) as number,
  };
}
