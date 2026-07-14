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

export interface ExpectedSearchResult {
  topUrl?: string;
  totalHits: number;
  facetValues?: Array<{ value: string; count: number; selected: boolean }>;
}

export interface BenchmarkQuery {
  id: string;
  query: string;
  options: {
    limit: number;
    filters?: Record<string, string | string[]>;
    facets?: string[];
  };
  expected: ExpectedSearchResult;
}

export interface BenchmarkWorkload {
  documents: Array<{ id: number; url: string; html: string }>;
  corpusHash: string;
  querySetHash: string;
  queries: BenchmarkQuery[];
  languageCounts: Record<string, number>;
}

export interface ArtifactMeasurement {
  path: string;
  rawBytes: number;
  gzipBytes: number;
}

export interface IndexMeasurement {
  documentCount: number;
  generationMs: number;
  buildMs: number;
  writeMs: number;
  totalRawBytes: number;
  totalGzipBytes: number;
  manifestRawBytes: number;
  fileCount: number;
  shardCount: number;
  artifacts: ArtifactMeasurement[];
}
