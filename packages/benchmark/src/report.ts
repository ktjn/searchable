import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { arch, cpus, platform, release } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { summarizeSamples } from "./statistics.js";
import type {
  BenchmarkConfig,
  BenchmarkEnvironment,
  BenchmarkQuery,
  BenchmarkReportV1,
  HeapMeasurement,
} from "./types.js";
import { hashCanonical } from "./workload.js";

function record(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value;
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function finite(value: unknown, name: string, integer = false): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    (integer && !Number.isInteger(value))
  ) {
    throw new Error(
      `${name} must be a finite non-negative${integer ? " integer" : ""}`,
    );
  }
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  const result = finite(value, name, true);
  if (result === 0) throw new Error(`${name} must be positive`);
  return result;
}

function sha256(value: unknown, name: string): string {
  const result = string(value, name);
  if (!/^[a-f0-9]{64}$/.test(result))
    throw new Error(`${name} must be SHA-256`);
  return result;
}

function validateSummary(
  value: unknown,
  name: string,
  expectedLength: number,
): number[] {
  const summary = record(value, name);
  const samples = array(summary.samples, `${name}.samples`).map(
    (sample, index) => finite(sample, `${name}.samples[${index}]`),
  );
  if (samples.length !== expectedLength) {
    throw new Error(`${name}.samples must contain ${expectedLength} values`);
  }
  const expected = summarizeSamples(samples);
  for (const key of ["p50", "p95", "min", "max"] as const) {
    if (summary[key] !== expected[key]) {
      throw new Error(`${name}.${key} does not match samples`);
    }
  }
  return samples;
}

function validateHeap(
  value: unknown,
  name: string,
): asserts value is HeapMeasurement {
  const heap = record(value, name);
  if (heap.status === "available") {
    finite(heap.usedBytes, `${name}.usedBytes`, true);
  } else if (heap.status === "unavailable") {
    string(heap.reason, `${name}.reason`);
  } else {
    throw new Error(`${name}.status is invalid`);
  }
}

function validateQuery(value: unknown, name: string): BenchmarkQuery {
  const query = record(value, name);
  string(query.id, `${name}.id`);
  if (typeof query.query !== "string")
    throw new Error(`${name}.query must be a string`);
  const options = record(query.options, `${name}.options`);
  positiveInteger(options.limit, `${name}.options.limit`);
  if (options.filters !== undefined) {
    for (const [field, filter] of Object.entries(
      record(options.filters, `${name}.options.filters`),
    )) {
      string(field, `${name}.options.filters field`);
      if (typeof filter !== "string") {
        for (const entry of array(filter, `${name}.options.filters.${field}`)) {
          string(entry, `${name}.options.filters.${field} value`);
        }
      }
    }
  }
  if (options.facets !== undefined) {
    for (const facet of array(options.facets, `${name}.options.facets`)) {
      string(facet, `${name}.options facet`);
    }
  }
  const expected = record(query.expected, `${name}.expected`);
  finite(expected.totalHits, `${name}.expected.totalHits`, true);
  if (expected.topUrl !== undefined)
    string(expected.topUrl, `${name}.expected.topUrl`);
  if (expected.facetValues !== undefined) {
    for (const [index, value] of array(
      expected.facetValues,
      `${name}.expected.facetValues`,
    ).entries()) {
      const facet = record(value, `${name}.expected.facetValues[${index}]`);
      string(facet.value, `${name}.expected.facetValues[${index}].value`);
      finite(facet.count, `${name}.expected.facetValues[${index}].count`, true);
      if (typeof facet.selected !== "boolean")
        throw new Error(`${name}.expected facet selected must be boolean`);
    }
  }
  return value as BenchmarkQuery;
}

export function validateReport(value: unknown): BenchmarkReportV1 {
  const report = record(value, "report");
  if (report.schemaVersion !== 1) throw new Error("schemaVersion must be 1");

  const run = record(report.run, "run");
  const startedAt = string(run.startedAt, "run.startedAt");
  if (new Date(startedAt).toISOString() !== startedAt)
    throw new Error("run.startedAt must be an ISO date");
  finite(run.completedInMs, "run.completedInMs");
  if (!/^[a-f0-9]{40}$/.test(string(run.commit, "run.commit")))
    throw new Error("run.commit must be a full Git hash");
  if (typeof run.dirty !== "boolean")
    throw new Error("run.dirty must be boolean");
  if (run.profile !== "cms-2k" && run.profile !== "smoke")
    throw new Error("run.profile is invalid");
  if (run.timingMethod !== "performance.now")
    throw new Error("run.timingMethod is invalid");
  finite(run.warmupCount, "run.warmupCount", true);
  const repeatCount = positiveInteger(run.repeatCount, "run.repeatCount");

  const environment = record(report.environment, "environment");
  for (const field of [
    "platform",
    "release",
    "architecture",
    "cpuModel",
    "nodeVersion",
    "pnpmVersion",
    "playwrightVersion",
    "chromiumVersion",
  ]) {
    string(environment[field], `environment.${field}`);
  }
  positiveInteger(environment.logicalCpuCount, "environment.logicalCpuCount");
  if (typeof environment.headless !== "boolean")
    throw new Error("environment.headless must be boolean");
  for (const flag of array(environment.launchFlags, "environment.launchFlags"))
    string(flag, "environment.launchFlags entry");

  const corpus = record(report.corpus, "corpus");
  if (corpus.generator !== "generateCms2kCorpus")
    throw new Error("corpus.generator is invalid");
  const documentCount = positiveInteger(
    corpus.documentCount,
    "corpus.documentCount",
  );
  sha256(corpus.sha256, "corpus.sha256");
  const languageCounts = record(corpus.languageCounts, "corpus.languageCounts");
  let languageTotal = 0;
  for (const [language, count] of Object.entries(languageCounts)) {
    string(language, "corpus language");
    languageTotal += positiveInteger(
      count,
      `corpus.languageCounts.${language}`,
    );
  }
  if (languageTotal !== documentCount)
    throw new Error("corpus language counts must equal documentCount");

  const index = record(report.index, "index");
  for (const field of ["documentCount", "fileCount", "shardCount"] as const)
    finite(index[field], `index.${field}`, true);
  for (const field of [
    "generationMs",
    "buildMs",
    "writeMs",
    "totalRawBytes",
    "totalGzipBytes",
    "manifestRawBytes",
  ] as const)
    finite(index[field], `index.${field}`);
  if (index.documentCount !== documentCount)
    throw new Error("index.documentCount must match corpus");
  const artifacts = array(index.artifacts, "index.artifacts");
  const artifactsByPath = new Map<
    string,
    { rawBytes: number; gzipBytes: number }
  >();
  let rawTotal = 0;
  let gzipTotal = 0;
  let previousPath = "";
  for (const [artifactIndex, value] of artifacts.entries()) {
    const artifact = record(value, `index.artifacts[${artifactIndex}]`);
    const path = string(
      artifact.path,
      `index.artifacts[${artifactIndex}].path`,
    );
    if (path <= previousPath)
      throw new Error("index artifacts must be uniquely path-sorted");
    previousPath = path;
    const rawBytes = finite(
      artifact.rawBytes,
      `index.artifacts[${artifactIndex}].rawBytes`,
      true,
    );
    const gzipBytes = finite(
      artifact.gzipBytes,
      `index.artifacts[${artifactIndex}].gzipBytes`,
      true,
    );
    rawTotal += rawBytes;
    gzipTotal += gzipBytes;
    artifactsByPath.set(path, { rawBytes, gzipBytes });
  }
  if (
    index.fileCount !== artifacts.length ||
    index.totalRawBytes !== rawTotal ||
    index.totalGzipBytes !== gzipTotal
  )
    throw new Error("index artifact totals do not match inventory");

  const queries = record(report.queries, "queries");
  if (queries.id !== "cms-2k-lexical-v1")
    throw new Error("queries.id is invalid");
  const definitions = array(queries.definitions, "queries.definitions");
  if (definitions.length === 0)
    throw new Error("queries.definitions must not be empty");
  const plainQueries: BenchmarkQuery[] = [];
  for (const [queryIndex, value] of definitions.entries()) {
    const definition = record(value, `queries.definitions[${queryIndex}]`);
    const definitionHash = sha256(
      definition.sha256,
      `queries.definitions[${queryIndex}].sha256`,
    );
    const { sha256: _hash, ...plain } = definition;
    const query = validateQuery(plain, `queries.definitions[${queryIndex}]`);
    if (hashCanonical(query) !== definitionHash)
      throw new Error(`query ${query.id} hash mismatch`);
    plainQueries.push(query);
  }
  if (hashCanonical(plainQueries) !== sha256(queries.sha256, "queries.sha256"))
    throw new Error("query-set hash mismatch");
  const queryIds = plainQueries.map(({ id }) => id);

  const cold = array(report.cold, "cold");
  if (
    cold.map((entry) => record(entry, "cold entry").id).join("\0") !==
    queryIds.join("\0")
  )
    throw new Error("cold query IDs must match definitions");
  for (const [coldIndex, value] of cold.entries()) {
    const measurement = record(value, `cold[${coldIndex}]`);
    const initializeSamples = validateSummary(
      measurement.initialize,
      `cold[${coldIndex}].initialize`,
      repeatCount,
    );
    const firstQuerySamples = validateSummary(
      measurement.firstQuery,
      `cold[${coldIndex}].firstQuery`,
      repeatCount,
    );
    const combinedSamples = validateSummary(
      measurement.combined,
      `cold[${coldIndex}].combined`,
      repeatCount,
    );
    const requestCountSamples = validateSummary(
      measurement.requestCount,
      `cold[${coldIndex}].requestCount`,
      repeatCount,
    );
    const rawBytesSamples = validateSummary(
      measurement.rawBytes,
      `cold[${coldIndex}].rawBytes`,
      repeatCount,
    );
    const gzipBytesSamples = validateSummary(
      measurement.gzipBytes,
      `cold[${coldIndex}].gzipBytes`,
      repeatCount,
    );
    for (let sample = 0; sample < repeatCount; sample += 1) {
      const initialize = initializeSamples[sample];
      const firstQuery = firstQuerySamples[sample];
      const combined = combinedSamples[sample];
      if (
        initialize === undefined ||
        firstQuery === undefined ||
        combined === undefined ||
        combined !== initialize + firstQuery
      ) {
        throw new Error(`cold[${coldIndex}].combined sample mismatch`);
      }
    }
    for (const field of ["heapAfterInitialize", "heapAfterQuery"] as const) {
      const heaps = array(measurement[field], `cold[${coldIndex}].${field}`);
      if (heaps.length !== repeatCount)
        throw new Error(`cold[${coldIndex}].${field} length mismatch`);
      heaps.forEach((heap, heapIndex) => {
        validateHeap(heap, `cold[${coldIndex}].${field}[${heapIndex}]`);
      });
    }
    const transfers = array(
      measurement.transfers,
      `cold[${coldIndex}].transfers`,
    );
    if (transfers.length !== repeatCount)
      throw new Error("cold transfers length mismatch");
    for (const [transferIndex, value] of transfers.entries()) {
      const transfer = record(
        value,
        `cold[${coldIndex}].transfers[${transferIndex}]`,
      );
      const requestCount = finite(
        transfer.requestCount,
        "transfer.requestCount",
        true,
      );
      const rawBytes = finite(transfer.rawBytes, "transfer.rawBytes", true);
      const gzipBytes = finite(transfer.gzipBytes, "transfer.gzipBytes", true);
      const paths = array(transfer.paths, "transfer.paths").map((path) =>
        string(path, "transfer path"),
      );
      if (requestCount !== paths.length)
        throw new Error("transfer requestCount must match paths length");
      let artifactRawBytes = 0;
      let artifactGzipBytes = 0;
      for (const path of paths) {
        const artifact = artifactsByPath.get(path);
        if (!artifact)
          throw new Error(`transfer path is missing from artifacts: ${path}`);
        artifactRawBytes += artifact.rawBytes;
        artifactGzipBytes += artifact.gzipBytes;
      }
      if (rawBytes !== artifactRawBytes)
        throw new Error("transfer artifact raw bytes mismatch");
      if (gzipBytes !== artifactGzipBytes)
        throw new Error("transfer artifact gzip bytes mismatch");
      if (
        requestCountSamples[transferIndex] !== requestCount ||
        rawBytesSamples[transferIndex] !== rawBytes ||
        gzipBytesSamples[transferIndex] !== gzipBytes
      ) {
        throw new Error("cold transfer summary samples mismatch");
      }
    }
  }

  const warm = record(report.warm, "warm");
  if (warm.indexRequestCount !== 0) throw new Error("unexpected warm network");
  validateSummary(warm.wholePass, "warm.wholePass", repeatCount);
  const warmQueries = array(warm.queries, "warm.queries");
  if (
    warmQueries.map((entry) => record(entry, "warm query").id).join("\0") !==
    queryIds.join("\0")
  )
    throw new Error("warm query IDs must match definitions");
  warmQueries.forEach((value, index) => {
    validateSummary(
      record(value, `warm.queries[${index}]`).duration,
      `warm.queries[${index}].duration`,
      repeatCount,
    );
  });
  validateHeap(warm.heapAfterInitialize, "warm.heapAfterInitialize");
  validateHeap(warm.heapAfterFinalPass, "warm.heapAfterFinalPass");

  return value as BenchmarkReportV1;
}

export interface ReportWriteIo {
  writeFile(
    path: string,
    data: string,
    options: { flag: "wx" },
  ): Promise<unknown>;
  rename(from: string, to: string): Promise<unknown>;
  rm(path: string, options: { force: true }): Promise<unknown>;
  destinationExists(path: string): Promise<boolean>;
}

const DEFAULT_WRITE_IO: ReportWriteIo = {
  writeFile,
  rename,
  rm,
  destinationExists: async (path) =>
    access(path).then(
      () => true,
      () => false,
    ),
};

export async function writeReportAtomic(
  report: BenchmarkReportV1,
  destination: string,
  io: ReportWriteIo = DEFAULT_WRITE_IO,
): Promise<void> {
  validateReport(report);
  if (await io.destinationExists(destination))
    throw new Error(`report already exists: ${destination}`);
  const temporary = join(
    dirname(destination),
    `${basename(destination)}.${randomUUID()}.tmp`,
  );
  try {
    await io.writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, {
      flag: "wx",
    });
    await io.rename(temporary, destination);
  } finally {
    await io.rm(temporary, { force: true }).catch(() => undefined);
  }
}

const execFileAsync = promisify(execFile);

export async function captureEnvironment(
  config: BenchmarkConfig,
  chromiumVersion: string,
): Promise<BenchmarkEnvironment> {
  const require = createRequire(import.meta.url);
  const playwrightPackage = require("@playwright/test/package.json") as {
    version: string;
  };
  const pnpmCommand =
    process.platform === "win32"
      ? {
          file: process.env.ComSpec ?? "cmd.exe",
          arguments: ["/d", "/s", "/c", "pnpm --version"],
        }
      : { file: "pnpm", arguments: ["--version"] };
  const { stdout: pnpmVersion } = await execFileAsync(
    pnpmCommand.file,
    pnpmCommand.arguments,
    { windowsHide: true },
  );
  const processors = cpus();
  return {
    platform: platform(),
    release: release(),
    architecture: arch(),
    cpuModel: processors[0]?.model ?? "unknown",
    logicalCpuCount: processors.length,
    nodeVersion: process.version,
    pnpmVersion: pnpmVersion.trim(),
    playwrightVersion: playwrightPackage.version,
    chromiumVersion,
    headless: config.headless,
    launchFlags: ["--enable-precise-memory-info"],
  };
}
