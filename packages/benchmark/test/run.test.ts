import { expect, it, vi } from "vitest";
import { SMOKE_CONFIG } from "../src/config.js";
import { runBenchmark } from "../src/run.js";
import type { BrowserMeasurement } from "../src/types.js";

function lifecycleDependencies() {
  const close = vi.fn(async () => undefined);
  const removeTemporaryDirectory = vi.fn(async () => undefined);
  const writeReport = vi.fn(async () => undefined);
  const browser: BrowserMeasurement = {
    browser: { name: "chromium", version: "140" },
    cold: [],
    warm: {
      wholePass: { samples: [1, 2], p50: 1, p95: 2, min: 1, max: 2 },
      queries: [],
      indexRequestCount: 0,
      heapAfterInitialize: { status: "unavailable", reason: "test" },
      heapAfterFinalPass: { status: "unavailable", reason: "test" },
    },
  };
  return {
    close,
    removeTemporaryDirectory,
    writeReport,
    browser,
    dependencies: {
      createTemporaryDirectory: async () => "C:/temp/benchmark-run",
      removeTemporaryDirectory,
      captureGitState: async () => ({ commit: "a".repeat(40), dirty: false }),
      createWorkload: () => ({
        documents: [],
        corpusHash: "a".repeat(64),
        querySetHash: "b".repeat(64),
        queries: [],
        languageCounts: {},
      }),
      measureIndex: async () => ({
        documentCount: 0,
        generationMs: 0,
        buildMs: 0,
        writeMs: 0,
        totalRawBytes: 0,
        totalGzipBytes: 0,
        manifestRawBytes: 0,
        fileCount: 0,
        shardCount: 0,
        artifacts: [],
      }),
      serveBenchmark: async () => ({
        baseUrl: "http://127.0.0.1:1/",
        indexUrl: "http://127.0.0.1:1/index/manifest.json",
        close,
      }),
      measureBrowser: async () => browser,
      captureEnvironment: async () => ({
        platform: "win32",
        release: "test",
        architecture: "x64",
        cpuModel: "test",
        logicalCpuCount: 1,
        nodeVersion: "v24",
        pnpmVersion: "11",
        playwrightVersion: "1",
        chromiumVersion: "140",
        headless: true,
        launchFlags: [],
      }),
      writeReport,
      now: () => 0,
      startedAt: () => "2026-07-14T08:00:00.000Z",
    },
  };
}

it("cleans server and temporary index when browser measurement fails", async () => {
  const setup = lifecycleDependencies();
  const original = new Error("browser failed");
  setup.dependencies.measureBrowser = async () => {
    throw original;
  };

  await expect(
    runBenchmark(SMOKE_CONFIG, "C:/repo", setup.dependencies),
  ).rejects.toBe(original);
  expect(setup.close).toHaveBeenCalledTimes(1);
  expect(setup.removeTemporaryDirectory).toHaveBeenCalledTimes(1);
  expect(setup.writeReport).not.toHaveBeenCalled();
});

it("cleans resources and writes no report when post-browser capture fails", async () => {
  const setup = lifecycleDependencies();
  const original = new Error("environment failed");
  setup.dependencies.captureEnvironment = async () => {
    throw original;
  };

  await expect(
    runBenchmark(SMOKE_CONFIG, "C:/repo", setup.dependencies),
  ).rejects.toBe(original);
  expect(setup.close).toHaveBeenCalledTimes(1);
  expect(setup.removeTemporaryDirectory).toHaveBeenCalledTimes(1);
  expect(setup.writeReport).not.toHaveBeenCalled();
});
