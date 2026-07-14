import type { BenchmarkReportV1 } from "../src/types.js";
import { hashCanonical } from "../src/workload.js";

export function createReportFixture(): BenchmarkReportV1 {
  const query = {
    id: "no-match",
    query: "zzzz-no-match",
    options: { limit: 10 },
    expected: { totalHits: 0 },
  };
  const summary = { samples: [1, 2], p50: 1, p95: 2, min: 1, max: 2 };
  const heap = { status: "unavailable" as const, reason: "test fixture" };
  return {
    schemaVersion: 1,
    run: {
      startedAt: "2026-07-14T08:00:00.000Z",
      completedInMs: 25,
      commit: "0123456789abcdef0123456789abcdef01234567",
      dirty: false,
      profile: "cms-2k",
      timingMethod: "performance.now",
      warmupCount: 1,
      repeatCount: 2,
    },
    environment: {
      platform: "win32",
      release: "test",
      architecture: "x64",
      cpuModel: "Test CPU",
      logicalCpuCount: 8,
      nodeVersion: "v24.0.0",
      pnpmVersion: "11.11.0",
      playwrightVersion: "1.49.1",
      chromiumVersion: "140.0.0.0",
      headless: true,
      launchFlags: ["--enable-precise-memory-info"],
    },
    corpus: {
      generator: "generateCms2kCorpus",
      documentCount: 1,
      languageCounts: { en: 1 },
      sha256: "a".repeat(64),
    },
    index: {
      documentCount: 1,
      generationMs: 1,
      buildMs: 2,
      writeMs: 3,
      totalRawBytes: 10,
      totalGzipBytes: 20,
      manifestRawBytes: 10,
      fileCount: 1,
      shardCount: 1,
      artifacts: [{ path: "manifest.json", rawBytes: 10, gzipBytes: 20 }],
    },
    queries: {
      id: "cms-2k-lexical-v1",
      sha256: hashCanonical([query]),
      definitions: [{ ...query, sha256: hashCanonical(query) }],
    },
    cold: [
      {
        id: "no-match",
        initialize: structuredClone(summary),
        firstQuery: structuredClone(summary),
        combined: structuredClone(summary),
        requestCount: structuredClone(summary),
        rawBytes: structuredClone(summary),
        gzipBytes: structuredClone(summary),
        transfers: [
          { requestCount: 1, rawBytes: 10, gzipBytes: 20, paths: ["manifest.json"] },
          { requestCount: 1, rawBytes: 10, gzipBytes: 20, paths: ["manifest.json"] },
        ],
        heapAfterInitialize: [heap, heap],
        heapAfterQuery: [heap, heap],
      },
    ],
    warm: {
      wholePass: structuredClone(summary),
      queries: [{ id: "no-match", duration: structuredClone(summary) }],
      indexRequestCount: 0,
      heapAfterInitialize: heap,
      heapAfterFinalPass: heap,
    },
  };
}
