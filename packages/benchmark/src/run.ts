import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { measureBrowser } from "./browser-measurement.js";
import { validateConfig } from "./config.js";
import { measureIndex } from "./index-measurement.js";
import {
  captureEnvironment,
  validateReport,
  writeReportAtomic,
} from "./report.js";
import type { BenchmarkServer } from "./server.js";
import { serveBenchmark } from "./server.js";
import type {
  BenchmarkConfig,
  BenchmarkEnvironment,
  BenchmarkReportV1,
  BenchmarkWorkload,
  BrowserMeasurement,
  IndexMeasurement,
} from "./types.js";
import { createWorkload, hashCanonical } from "./workload.js";

const execFileAsync = promisify(execFile);

export interface GitState {
  commit: string;
  dirty: boolean;
}

export interface RunBenchmarkDependencies {
  createTemporaryDirectory(): Promise<string>;
  removeTemporaryDirectory(path: string): Promise<unknown>;
  captureGitState(repositoryRoot: string): Promise<GitState>;
  createWorkload(config: BenchmarkConfig): BenchmarkWorkload;
  measureIndex(
    documents: BenchmarkWorkload["documents"],
    generationMs: number,
    outputDirectory: string,
  ): Promise<IndexMeasurement>;
  serveBenchmark(options: {
    indexDirectory: string;
    clientDirectory: string;
  }): Promise<BenchmarkServer>;
  measureBrowser(options: {
    config: BenchmarkConfig;
    queries: BenchmarkWorkload["queries"];
    server: BenchmarkServer;
    artifacts: IndexMeasurement["artifacts"];
  }): Promise<BrowserMeasurement>;
  captureEnvironment(
    config: BenchmarkConfig,
    chromiumVersion: string,
  ): Promise<BenchmarkEnvironment>;
  ensureDirectory(path: string): Promise<unknown>;
  writeReport(report: BenchmarkReportV1, path: string): Promise<unknown>;
  now(): number;
  startedAt(): string;
}

async function captureGitState(repositoryRoot: string): Promise<GitState> {
  const [{ stdout: commit }, { stdout: status }] = await Promise.all([
    execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      windowsHide: true,
    }),
    execFileAsync("git", ["status", "--porcelain"], {
      cwd: repositoryRoot,
      windowsHide: true,
    }),
  ]);
  return { commit: commit.trim(), dirty: status.trim().length > 0 };
}

const DEFAULT_DEPENDENCIES: RunBenchmarkDependencies = {
  createTemporaryDirectory: () =>
    mkdtemp(join(tmpdir(), "searchable-benchmark-run-")),
  removeTemporaryDirectory: (path) =>
    rm(path, { recursive: true, force: true }),
  captureGitState,
  createWorkload,
  measureIndex,
  serveBenchmark,
  measureBrowser,
  captureEnvironment,
  ensureDirectory: (path) => mkdir(path, { recursive: true }),
  writeReport: writeReportAtomic,
  now: () => performance.now(),
  startedAt: () => new Date().toISOString(),
};

export async function runBenchmark(
  config: BenchmarkConfig,
  repositoryRoot: string,
  dependencyOverrides: Partial<RunBenchmarkDependencies> = {},
): Promise<{ report: BenchmarkReportV1; outputPath: string }> {
  validateConfig(config);
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  const git = await dependencies.captureGitState(repositoryRoot);
  if (config.requireCleanWorktree && git.dirty) {
    throw new Error("cms-2k baseline requires a clean worktree");
  }

  const startedAt = dependencies.startedAt();
  const runStarted = dependencies.now();
  const temporaryDirectory = await dependencies.createTemporaryDirectory();
  let server: BenchmarkServer | undefined;
  let result: { report: BenchmarkReportV1; outputPath: string } | undefined;
  let runError: unknown;
  try {
    const generationStarted = dependencies.now();
    const workload = dependencies.createWorkload(config);
    const generationMs = dependencies.now() - generationStarted;
    const index = await dependencies.measureIndex(
      workload.documents,
      generationMs,
      temporaryDirectory,
    );
    server = await dependencies.serveBenchmark({
      indexDirectory: temporaryDirectory,
      clientDirectory: join(repositoryRoot, "packages", "client", "dist"),
    });
    const browser = await dependencies.measureBrowser({
      config,
      queries: workload.queries,
      server,
      artifacts: index.artifacts,
    });
    const environment = await dependencies.captureEnvironment(
      config,
      browser.browser.version,
    );
    const definitions = workload.queries.map((query) => ({
      ...query,
      sha256: hashCanonical(query),
    }));
    const report: BenchmarkReportV1 = {
      schemaVersion: 1,
      run: {
        startedAt,
        completedInMs: dependencies.now() - runStarted,
        commit: git.commit,
        dirty: git.dirty,
        profile: config.profile,
        timingMethod: "performance.now",
        warmupCount: config.warmupCount,
        repeatCount: config.repeatCount,
      },
      environment,
      corpus: {
        generator: "generateCms2kCorpus",
        documentCount: workload.documents.length,
        languageCounts: workload.languageCounts,
        sha256: workload.corpusHash,
      },
      index,
      queries: {
        id: "cms-2k-lexical-v1",
        sha256: workload.querySetHash,
        definitions,
      },
      cold: browser.cold,
      warm: browser.warm,
    };
    validateReport(report);

    const outputDirectory = join(
      repositoryRoot,
      "benchmark-results",
      config.profile,
    );
    const timestamp = startedAt.replace(/[:.]/g, "-");
    const outputPath = join(
      outputDirectory,
      `${timestamp}-${git.commit.slice(0, 7)}.json`,
    );
    result = { report, outputPath };
  } catch (error) {
    runError = error;
  }

  const cleanupErrors: unknown[] = [];
  if (server) {
    await server.close().catch((error) => cleanupErrors.push(error));
  }
  await dependencies
    .removeTemporaryDirectory(temporaryDirectory)
    .catch((error) => cleanupErrors.push(error));

  if (runError !== undefined) throw runError;
  if (cleanupErrors.length > 0) throw cleanupErrors[0];
  if (result === undefined)
    throw new Error("benchmark completed without a result");
  await dependencies.ensureDirectory(dirname(result.outputPath));
  await dependencies.writeReport(result.report, result.outputPath);
  return result;
}
