import { expect, it, vi } from "vitest";
import { SMOKE_CONFIG } from "../src/config.js";
import { runBenchmark } from "../src/run.js";
import type { BrowserMeasurement } from "../src/types.js";
import { createReportFixture } from "./report-fixture.js";

function lifecycleDependencies() {
  const fixture = createReportFixture();
  const definition = fixture.queries.definitions[0];
  if (!definition) throw new Error("fixture must contain a query");
  const { sha256: _queryHash, ...query } = definition;
  const close = vi.fn(async () => undefined);
  const removeTemporaryDirectory = vi.fn(async () => undefined);
  const writeReport = vi.fn(async () => undefined);
  const browser: BrowserMeasurement = {
    browser: { name: "chromium", version: "140" },
    cold: fixture.cold,
    warm: fixture.warm,
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
        documents: [
          {
            id: 1,
            url: "/one",
            html: '<html lang="en"><body>one</body></html>',
          },
        ],
        corpusHash: fixture.corpus.sha256,
        querySetHash: fixture.queries.sha256,
        queries: [query],
        languageCounts: fixture.corpus.languageCounts,
      }),
      measureIndex: async () => fixture.index,
      serveBenchmark: async () => ({
        baseUrl: "http://127.0.0.1:1/",
        indexUrl: "http://127.0.0.1:1/index/manifest.json",
        close,
      }),
      measureBrowser: async () => browser,
      captureEnvironment: async () => fixture.environment,
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

it("does not write a final report when cleanup fails", async () => {
  const setup = lifecycleDependencies();
  const original = new Error("cleanup failed");
  setup.dependencies.removeTemporaryDirectory = async () => {
    throw original;
  };

  await expect(
    runBenchmark(SMOKE_CONFIG, "C:/repo", setup.dependencies),
  ).rejects.toBe(original);
  expect(setup.close).toHaveBeenCalledTimes(1);
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
