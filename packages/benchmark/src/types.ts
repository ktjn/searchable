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

export type HeapMeasurement =
  | { status: "available"; usedBytes: number }
  | { status: "unavailable"; reason: string };

export interface TransferSample {
  requestCount: number;
  rawBytes: number;
  gzipBytes: number;
  paths: string[];
}

export interface ColdQueryMeasurement {
  id: string;
  initialize: SampleSummary;
  firstQuery: SampleSummary;
  combined: SampleSummary;
  requestCount: SampleSummary;
  rawBytes: SampleSummary;
  gzipBytes: SampleSummary;
  transfers: TransferSample[];
  heapAfterInitialize: HeapMeasurement[];
  heapAfterQuery: HeapMeasurement[];
}

export interface WarmQueryMeasurement {
  id: string;
  duration: SampleSummary;
}

export interface WarmMeasurement {
  wholePass: SampleSummary;
  queries: WarmQueryMeasurement[];
  indexRequestCount: 0;
  heapAfterInitialize: HeapMeasurement;
  heapAfterFinalPass: HeapMeasurement;
}

export interface BrowserMeasurement {
  browser: { name: "chromium"; version: string };
  cold: ColdQueryMeasurement[];
  warm: WarmMeasurement;
}
