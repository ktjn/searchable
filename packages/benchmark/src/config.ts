import type { BenchmarkConfig } from "./types.js";

export const BASELINE_CONFIG: BenchmarkConfig = {
  profile: "cms-2k",
  documentCount: 2000,
  warmupCount: 1,
  repeatCount: 10,
  requireCleanWorktree: true,
  headless: true,
};

export const SMOKE_CONFIG: BenchmarkConfig = {
  profile: "smoke",
  documentCount: 40,
  warmupCount: 1,
  repeatCount: 2,
  requireCleanWorktree: false,
  headless: true,
};

export function validateConfig(config: BenchmarkConfig): void {
  if (!Number.isInteger(config.documentCount) || config.documentCount <= 0) {
    throw new Error("documentCount must be a positive integer");
  }
  if (!Number.isInteger(config.warmupCount) || config.warmupCount < 0) {
    throw new Error("warmupCount must be a non-negative integer");
  }
  if (!Number.isInteger(config.repeatCount) || config.repeatCount <= 0) {
    throw new Error("repeatCount must be a positive integer");
  }
}
