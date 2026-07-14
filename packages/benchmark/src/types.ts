export type BenchmarkProfile = "cms-2k" | "smoke";

export interface BenchmarkConfig {
  profile: BenchmarkProfile;
  documentCount: number;
  warmupCount: number;
  repeatCount: number;
  requireCleanWorktree: boolean;
  headless: boolean;
}

export interface SampleSummary {
  samples: number[];
  p50: number;
  p95: number;
  min: number;
  max: number;
}
