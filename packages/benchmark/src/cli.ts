import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BASELINE_CONFIG, SMOKE_CONFIG } from "./config.js";
import { runBenchmark } from "./run.js";
import type { BenchmarkProfile, HeapMeasurement } from "./types.js";

function parseProfile(arguments_: string[]): BenchmarkProfile {
  if (arguments_.length !== 2 || arguments_[0] !== "--profile") {
    throw new Error("usage: cli.js --profile cms-2k|smoke");
  }
  const profile = arguments_[1];
  if (profile !== "cms-2k" && profile !== "smoke") {
    throw new Error(`unsupported profile: ${profile ?? "missing"}`);
  }
  return profile;
}

function heapStatus(heap: HeapMeasurement): string {
  return heap.status === "available"
    ? `${heap.usedBytes} bytes`
    : `unavailable (${heap.reason})`;
}

async function main(): Promise<void> {
  const profile = parseProfile(process.argv.slice(2));
  const config = profile === "cms-2k" ? BASELINE_CONFIG : SMOKE_CONFIG;
  const repositoryRoot = resolve(
    fileURLToPath(new URL("../../..", import.meta.url)),
  );
  const { report, outputPath } = await runBenchmark(config, repositoryRoot);
  console.log(`Report: ${outputPath}`);
  console.log(
    `Corpus: ${report.corpus.documentCount} documents (${report.corpus.sha256})`,
  );
  console.log(
    `Index: ${report.index.totalRawBytes} raw bytes; ${report.index.totalGzipBytes} gzip-equivalent bytes`,
  );
  for (const cold of report.cold) {
    console.log(
      `Cold ${cold.id}: p50 ${cold.combined.p50.toFixed(2)} ms; p95 ${cold.combined.p95.toFixed(2)} ms; ${cold.gzipBytes.p50} gzip-equivalent bytes`,
    );
  }
  console.log(
    `Warm pass: p50 ${report.warm.wholePass.p50.toFixed(2)} ms; p95 ${report.warm.wholePass.p95.toFixed(2)} ms`,
  );
  console.log(
    `Heap: initialize ${heapStatus(report.warm.heapAfterInitialize)}; final ${heapStatus(report.warm.heapAfterFinalPass)}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
