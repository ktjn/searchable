import { describe, expect, it, vi } from "vitest";
import {
  captureEnvironment,
  validateReport,
  writeReportAtomic,
} from "../src/report.js";
import type { BenchmarkReportV1 } from "../src/types.js";
import { hashCanonical } from "../src/workload.js";

export function createReportFixture(): BenchmarkReportV1 {
  const query = {
    id: "no-match",
    query: "zzzz-no-match",
    options: { limit: 10 },
    expected: { totalHits: 0 },
  };
  const summary = {
    samples: [1, 2],
    p50: 1,
    p95: 2,
    min: 1,
    max: 2,
  };
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

describe("benchmark report validation", () => {
  it("captures the installed pnpm version on the host platform", async () => {
    const environment = await captureEnvironment(
      {
        profile: "smoke",
        documentCount: 40,
        warmupCount: 1,
        repeatCount: 2,
        requireCleanWorktree: false,
        headless: true,
      },
      "140",
    );
    expect(environment.pnpmVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("validates a complete schema-v1 report and its invariants", () => {
    const report = createReportFixture();
    expect(validateReport(report)).toBe(report);
    expect(() => validateReport({ ...report, schemaVersion: 2 })).toThrow(
      /schemaVersion/,
    );
    expect(() =>
      validateReport({
        ...report,
        warm: { ...report.warm, indexRequestCount: 1 },
      }),
    ).toThrow(/warm network/);
    expect(() =>
      validateReport({
        ...report,
        cold: [
          {
            ...report.cold[0]!,
            firstQuery: { samples: [Number.NaN] },
          },
        ],
      }),
    ).toThrow(/finite/);
  });

  it("removes its temporary sibling when the atomic rename fails", async () => {
    const order: string[] = [];
    const writeFile = vi.fn(async () => order.push("write"));
    const rename = vi.fn(async () => {
      order.push("rename");
      throw new Error("rename failed");
    });
    const rm = vi.fn(async () => order.push("remove"));

    await expect(
      writeReportAtomic(createReportFixture(), "C:/reports/result.json", {
        writeFile,
        rename,
        rm,
        destinationExists: async () => false,
      }),
    ).rejects.toThrow("rename failed");
    expect(order).toEqual(["write", "rename", "remove"]);
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/result\.json\..+\.tmp$/),
      expect.stringContaining('"schemaVersion": 1'),
      { flag: "wx" },
    );
  });
});
