#!/usr/bin/env node
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";
import { generateCms2kCorpus } from "@csf/fixtures";
import { buildIndex, writeIndex } from "../dist/index.js";

/**
 * JSON-tier scaling baseline for the Phase 7 investigation
 * (docs/11-binary-vs-json-index.md, docs/09-roadmap.md#phase-7--scale-options):
 * builds real synthetic corpora at increasing sizes through the actual
 * buildIndex()/writeIndex() pipeline (not a simulation) and reports the
 * concrete metrics that investigation's "should we, and when" question
 * turns on -- build time, on-disk shard sizes (raw and gzip), and the
 * size of the *single* term shard a query today must fetch (see the
 * finding below). Deliberately a plain Node script against the built
 * `dist/`, not a Vitest bench file -- this is a one-shot corpus-scaling
 * report meant to be read, not a statistically-repeated micro-benchmark
 * (docs/10-testing-and-performance.md's micro-benchmark category is a
 * different, smaller-scoped thing). Run via `pnpm --filter @csf/indexer bench`.
 *
 * Capped at 100k documents, not the 1M docs/11's follow-up note
 * mentions: the 100k build alone uses several GB of resident memory in
 * this reference (in-memory, non-streaming) indexer, and scaling that
 * further risks exceeding available memory on a typical CI/dev
 * machine -- itself a real finding (the reference indexer's in-memory
 * build model has a practical ceiling well before 1M docs, a separate
 * concern from the JSON-vs-binary question this investigation is
 * actually about) rather than something to push through by brute
 * force here.
 *
 * Headline finding this script exists to surface with real numbers,
 * not just describe: `writeIndex()` currently emits exactly *one*
 * term shard per language (`terms/<lang>/all.json`, `prefix: "all"`),
 * not the per-first-character-prefix sharding
 * docs/02-index-format.md#term-shard-inverted-index describes as the
 * design ("a query for 'widget' only ever fetches the `w` shard").
 * This was Phase 1's documented "small corpus mode" simplification
 * (docs/09-roadmap.md's Phase 1 section), never revisited -- so today,
 * literally every query fetches and parses the *entire* per-language
 * vocabulary, regardless of corpus size. That means the core
 * "first-query cost stays roughly flat as the corpus grows" claim
 * docs/02's sharding design exists to guarantee does not currently
 * hold at all -- this script's own numbers below are the "per-query
 * bytes fetched" column, unqualified, since there's only one term
 * shard to fetch either way.
 */

const SIZES = process.env.CSF_BENCH_SIZES
  ? process.env.CSF_BENCH_SIZES.split(",").map(Number)
  : [1000, 10000, 100000];

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

async function dirSizes(rootDir) {
  let totalRaw = 0;
  let totalGzip = 0;
  const files = [];

  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        const buf = await readFile(full);
        const gz = gzipSync(buf, { level: 9 });
        totalRaw += buf.length;
        totalGzip += gz.length;
        files.push({
          path: relative(rootDir, full),
          raw: buf.length,
          gzip: gz.length,
        });
      }
    }
  }

  await walk(rootDir);
  return { totalRaw, totalGzip, files };
}

async function benchOne(count) {
  const sources = generateCms2kCorpus({ count });

  const buildStart = performance.now();
  const built = buildIndex(sources);
  const buildMs = performance.now() - buildStart;

  const outDir = await mkdtemp(join(tmpdir(), "csf-bench-json-tier-"));
  const writeStart = performance.now();
  await writeIndex(built, outDir);
  const writeMs = performance.now() - writeStart;

  const { totalRaw, totalGzip, files } = await dirSizes(outDir);

  const manifest = JSON.parse(
    await readFile(join(outDir, "manifest.json"), "utf8"),
  );
  const termShardEntries = manifest.shards.terms; // today: exactly one per language, prefix "all"
  const termShardStats = [];
  for (const entry of termShardEntries) {
    const path = join(outDir, entry.file);
    const raw = await readFile(path, "utf8");
    const rawBytes = Buffer.byteLength(raw, "utf8");
    const gzipBytes = gzipSync(raw, { level: 9 }).length;
    const parseStart = performance.now();
    JSON.parse(raw);
    const parseMs = performance.now() - parseStart;
    termShardStats.push({
      lang: entry.lang,
      prefix: entry.prefix,
      termCount: entry.termCount,
      rawBytes,
      gzipBytes,
      parseMs,
    });
  }

  await rm(outDir, { recursive: true, force: true });

  return {
    count,
    buildMs,
    writeMs,
    totalRaw,
    totalGzip,
    fileCount: files.length,
    termShardStats,
  };
}

async function main() {
  const results = [];
  for (const count of SIZES) {
    console.log(`\n=== ${count.toLocaleString()} documents ===`);
    const result = await benchOne(count);
    results.push(result);
    console.log(`build:  ${result.buildMs.toFixed(0)} ms`);
    console.log(`write:  ${result.writeMs.toFixed(0)} ms`);
    console.log(
      `total index size: ${formatBytes(result.totalRaw)} raw, ${formatBytes(result.totalGzip)} gzip, ${result.fileCount} files`,
    );
    for (const s of result.termShardStats) {
      console.log(
        `  term shard [${s.lang}] (${s.termCount} terms): ${formatBytes(s.rawBytes)} raw, ${formatBytes(s.gzipBytes)} gzip, JSON.parse ${s.parseMs.toFixed(1)} ms -- fetched+parsed by EVERY query, regardless of term`,
      );
    }
  }

  console.log(
    "\n=== Summary (per-query bytes fetched today = the single term shard above) ===",
  );
  console.log("docs\tbuildMs\ttermShardGzipBytes(en)\ttermShardParseMs(en)");
  for (const r of results) {
    const en = r.termShardStats.find((s) => s.lang === "en");
    console.log(
      `${r.count}\t${r.buildMs.toFixed(0)}\t${en?.gzipBytes ?? "n/a"}\t${en?.parseMs.toFixed(1) ?? "n/a"}`,
    );
  }

  console.log(
    "\nSee docs/11-binary-vs-json-index.md and docs/09-roadmap.md#phase-7--scale-options for interpretation.",
  );

  console.log(
    `\n${JSON.stringify({ commit: process.env.GITHUB_SHA ?? "local", results }, null, 2)}`,
  );
}

main();
