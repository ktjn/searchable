import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { validateReport } from "./report.js";
import type { BenchmarkReportV1, HeapMeasurement } from "./types.js";

function milliseconds(value: number): string {
  return `${value.toFixed(2)} ms`;
}

function bytes(value: number): string {
  const units = ["B", "KiB", "MiB", "GiB"];
  let display = value;
  let unit = 0;
  while (display >= 1024 && unit < units.length - 1) {
    display /= 1024;
    unit += 1;
  }
  return `${value} B (${display.toFixed(unit === 0 ? 0 : 2)} ${units[unit]})`;
}

function heap(heapMeasurement: HeapMeasurement): string {
  return heapMeasurement.status === "available"
    ? bytes(heapMeasurement.usedBytes)
    : `Unavailable: ${heapMeasurement.reason}`;
}

export function renderPerformanceBaseline(
  report: BenchmarkReportV1,
  reportSha256: string,
): string {
  const coldRows = report.cold
    .map(
      (query) =>
        `| ${query.id} | ${milliseconds(query.initialize.p50)} | ${milliseconds(query.initialize.p95)} | ${milliseconds(query.firstQuery.p50)} | ${milliseconds(query.firstQuery.p95)} | ${milliseconds(query.combined.p50)} | ${milliseconds(query.combined.p95)} | ${bytes(query.gzipBytes.p50)} |`,
    )
    .join("\n");
  const warmRows = report.warm.queries
    .map(
      (query) =>
        `| ${query.id} | ${milliseconds(query.duration.p50)} | ${milliseconds(query.duration.p95)} |`,
    )
    .join("\n");

  return `# Performance baseline

## CMS-2k Chromium vertical baseline

This reviewed run records ${report.run.repeatCount} measured repetitions after ${report.run.warmupCount} warm-up repetition. The exact report SHA-256 is \`${reportSha256}\`.

## Workload

- Generator: \`${report.corpus.generator}\`
- Documents: ${report.corpus.documentCount}
- Languages: ${Object.entries(report.corpus.languageCounts).map(([language, count]) => `${language}: ${count}`).join(", ")}
- Corpus SHA-256: \`${report.corpus.sha256}\`
- Query set: \`${report.queries.id}\` (\`${report.queries.sha256}\`)

## Environment

- Commit: \`${report.run.commit}\` (clean: ${String(!report.run.dirty)})
- Platform: ${report.environment.platform} ${report.environment.release} (${report.environment.architecture})
- CPU: ${report.environment.cpuModel}, ${report.environment.logicalCpuCount} logical CPUs
- Node: ${report.environment.nodeVersion}; pnpm: ${report.environment.pnpmVersion}
- Playwright: ${report.environment.playwrightVersion}; Chromium: ${report.environment.chromiumVersion}
- Headless: ${String(report.environment.headless)}; flags: ${report.environment.launchFlags.map((flag) => `\`${flag}\``).join(", ")}

## Index build and output

| Measure | Value |
| --- | ---: |
| Corpus generation | ${milliseconds(report.index.generationMs)} |
| Index build | ${milliseconds(report.index.buildMs)} |
| Index write | ${milliseconds(report.index.writeMs)} |
| Files / shards | ${report.index.fileCount} / ${report.index.shardCount} |
| Raw artifact bytes | ${bytes(report.index.totalRawBytes)} |
| gzip-equivalent artifact bytes | ${bytes(report.index.totalGzipBytes)} |
| Manifest raw bytes | ${bytes(report.index.manifestRawBytes)} |

## Cold search

Each sample initializes a fresh strict, main-thread client in a fresh Chromium context and executes exactly one query.

| Query | Initialize p50 | Initialize p95 | First query p50 | First query p95 | Combined p50 | Combined p95 | Transfer p50 gzip-equivalent |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${coldRows}

## Warm search

Measured passes made ${report.warm.indexRequestCount} successful index requests.

| Query | p50 | p95 |
| --- | ---: | ---: |
${warmRows}

Whole ordered pass: p50 ${milliseconds(report.warm.wholePass.p50)}, p95 ${milliseconds(report.warm.wholePass.p95)}.

## Heap status

- After warm initialization: ${heap(report.warm.heapAfterInitialize)}
- After final warm pass: ${heap(report.warm.heapAfterFinalPass)}

## Reproduce

\`\`\`sh
pnpm benchmark:baseline
pnpm benchmark:render <explicit-report-path>
\`\`\`

## Query definitions

\`\`\`json
${JSON.stringify(report.queries.definitions, null, 2)}
\`\`\`

## Interpretation limits

This is reproducible evidence for one vertical configuration, not a performance budget. It is also not a supported operating range: different corpora, hardware, browsers, cache states, and query mixes can produce materially different results. gzip-equivalent sizes are level-9 calculations over emitted bytes, not observed Content-Encoding payload sizes.
`;
}

interface PromotionIo {
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, data: string | Buffer, options: { flag: "wx" }): Promise<unknown>;
  rename(from: string, to: string): Promise<unknown>;
  rm(path: string, options: { force: true }): Promise<unknown>;
  mkdir(path: string): Promise<unknown>;
  exists(path: string): Promise<boolean>;
}

const DEFAULT_IO: PromotionIo = {
  readFile: (path) => readFile(path),
  writeFile,
  rename,
  rm,
  mkdir: (path) => mkdir(path, { recursive: true }),
  exists: (path) => access(path).then(() => true, () => false),
};

export async function promoteAndRender(
  reportPath: string,
  repositoryRoot: string,
  overrides: Partial<PromotionIo> = {},
): Promise<{ reviewedReportPath: string; markdownPath: string }> {
  const io = { ...DEFAULT_IO, ...overrides };
  const inputPath = resolve(reportPath);
  const reviewedReportPath = join(
    repositoryRoot,
    "benchmark-results",
    "cms-2k",
    "reviewed-baseline.json",
  );
  const markdownPath = join(
    repositoryRoot,
    "docs",
    "project",
    "performance-baseline.md",
  );
  const inputBytes = await io.readFile(inputPath);
  const report = validateReport(JSON.parse(inputBytes.toString("utf8")));
  if (report.run.profile !== "cms-2k") throw new Error("only cms-2k reports can be promoted");
  if (report.run.dirty) throw new Error("cms-2k report must come from a clean worktree");
  const reportSha256 = createHash("sha256").update(inputBytes).digest("hex");
  const markdown = renderPerformanceBaseline(report, reportSha256);

  await io.mkdir(dirname(reviewedReportPath));
  await io.mkdir(dirname(markdownPath));
  const sameReport = resolve(reviewedReportPath) === inputPath;
  const targets = [
    ...(sameReport ? [] : [{ path: reviewedReportPath, data: inputBytes }]),
    { path: markdownPath, data: markdown },
  ];
  const transaction = randomUUID();
  const states = targets.map((target) => ({
    ...target,
    stage: `${target.path}.stage-${transaction}`,
    backup: `${target.path}.backup-${transaction}`,
    backedUp: false,
    promoted: false,
  }));

  try {
    for (const state of states) {
      await io.writeFile(state.stage, state.data, { flag: "wx" });
    }
    for (const state of states) {
      if (await io.exists(state.path)) {
        await io.rename(state.path, state.backup);
        state.backedUp = true;
      }
    }
    for (const state of states) {
      await io.rename(state.stage, state.path);
      state.promoted = true;
    }
  } catch (error) {
    for (const state of [...states].reverse()) {
      if (state.promoted) await io.rm(state.path, { force: true }).catch(() => undefined);
      if (state.backedUp) await io.rename(state.backup, state.path).catch(() => undefined);
    }
    throw error;
  } finally {
    for (const state of states) {
      await io.rm(state.stage, { force: true }).catch(() => undefined);
      await io.rm(state.backup, { force: true }).catch(() => undefined);
    }
  }

  return { reviewedReportPath, markdownPath };
}
