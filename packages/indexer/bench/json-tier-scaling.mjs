#!/usr/bin/env node
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";
import { generateCms2kCorpus } from "@ktjn/searchable-fixtures";
import { buildIndex, writeIndex } from "../dist/index.js";

/**
 * JSON-tier scaling baseline for the Phase 7 investigation
 * (docs/concepts/binary-storage.md, docs/archive/roadmaps/implementation-history.md#phase-7--scale-options):
 * builds real synthetic corpora at increasing sizes through the actual
 * buildIndex()/writeIndex() pipeline (not a simulation) and reports the
 * concrete metrics that investigation's "should we, and when" question
 * turns on -- build time, on-disk shard sizes (raw and gzip), and the
 * size of the *largest single term shard* a query could have to fetch
 * (see below, now that real per-prefix sharding exists). Deliberately a
 * plain Node script against the built `dist/`, not a Vitest bench file --
 * this is a one-shot corpus-scaling report meant to be read, not a
 * statistically-repeated micro-benchmark (docs/project/governance.md's
 * micro-benchmark category is a different, smaller-scoped thing). Run
 * via `pnpm --filter @ktjn/searchable-indexer bench`.
 *
 * Capped at 100k documents, not the 1M docs/concepts/binary-storage.md's follow-up note
 * mentions: the 100k build alone uses several GB of resident memory in
 * this reference (in-memory, non-streaming) indexer, and scaling that
 * further risks exceeding available memory on a typical CI/dev
 * machine -- itself a real finding (the reference indexer's in-memory
 * build model has a practical ceiling well before 1M docs, a separate
 * concern from the JSON-vs-binary question this investigation is
 * actually about) rather than something to push through by brute
 * force here.
 *
 * `writeIndex()` now shards each language's term shard by
 * first-character prefix (auto-widening to two characters for any
 * over-large bucket, per docs/concepts/index-format.md#term-shard-inverted-index
 * and #size-targets-and-sharding-tuning) -- real prefix sharding, not the
 * single unsharded `terms/<lang>/all.json` Phase 1 originally shipped
 * (see the fixed Phase 7 bullet in docs/project/roadmap.md for that history).
 * So the per-query fetch cost this script now reports is the size of
 * *one* prefix shard -- the largest one that exists for a language is
 * the honest worst case, since any single query term only ever needs
 * exactly one (or, for a prefix query overlapping more than one bucket,
 * a small handful of) shard(s), never the whole vocabulary. Tracking
 * how that largest-shard size grows with corpus size (rather than
 * assuming it stays flat) is the actual empirical answer to docs/concepts/index-format.md's
 * "first-query cost stays roughly flat as the corpus grows" claim.
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

function median(sortedNums) {
  const mid = Math.floor(sortedNums.length / 2);
  return sortedNums.length % 2 !== 0
    ? sortedNums[mid]
    : ((sortedNums[mid - 1] ?? 0) + (sortedNums[mid] ?? 0)) / 2;
}

/** Per-language shard-size distribution stats, plus a real JSON.parse timing on the single largest shard -- the honest worst-case per-query cost now that shards are prefix-sharded rather than one-per-language. */
async function termShardStatsForLanguage(outDir, entries) {
  const perShard = [];
  for (const entry of entries) {
    const raw = await readFile(join(outDir, entry.file), "utf8");
    perShard.push({
      prefix: entry.prefix,
      termCount: entry.termCount,
      rawBytes: Buffer.byteLength(raw, "utf8"),
      gzipBytes: gzipSync(raw, { level: 9 }).length,
      raw,
    });
  }
  perShard.sort((a, b) => b.gzipBytes - a.gzipBytes);
  const largest = perShard[0];
  let largestParseMs;
  if (largest) {
    const parseStart = performance.now();
    JSON.parse(largest.raw);
    largestParseMs = performance.now() - parseStart;
  }
  const gzipSizes = perShard.map((s) => s.gzipBytes).sort((a, b) => a - b);
  return {
    lang: entries[0]?.lang,
    shardCount: perShard.length,
    totalGzipBytes: gzipSizes.reduce((a, b) => a + b, 0),
    minGzipBytes: gzipSizes[0],
    medianGzipBytes: median(gzipSizes),
    maxGzipBytes: gzipSizes[gzipSizes.length - 1],
    largestShardPrefix: largest?.prefix,
    largestShardTermCount: largest?.termCount,
    largestShardRawBytes: largest?.rawBytes,
    largestShardGzipBytes: largest?.gzipBytes,
    largestShardParseMs: largestParseMs,
  };
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
  const languages = [
    ...new Set(manifest.shards.terms.map((s) => s.lang)),
  ].sort();
  const termShardStatsByLang = [];
  for (const lang of languages) {
    const entries = manifest.shards.terms.filter((s) => s.lang === lang);
    termShardStatsByLang.push(await termShardStatsForLanguage(outDir, entries));
  }

  await rm(outDir, { recursive: true, force: true });

  return {
    count,
    buildMs,
    writeMs,
    totalRaw,
    totalGzip,
    fileCount: files.length,
    termShardStatsByLang,
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
    for (const s of result.termShardStatsByLang) {
      console.log(
        `  [${s.lang}] ${s.shardCount} term shards, gzip sizes ${formatBytes(s.minGzipBytes)}..${formatBytes(s.maxGzipBytes)} (median ${formatBytes(s.medianGzipBytes)}), total ${formatBytes(s.totalGzipBytes)}`,
      );
      console.log(
        `    largest single shard [prefix "${s.largestShardPrefix}", ${s.largestShardTermCount} terms]: ${formatBytes(s.largestShardRawBytes)} raw, ${formatBytes(s.largestShardGzipBytes)} gzip, JSON.parse ${s.largestShardParseMs.toFixed(1)} ms -- the worst case any single query could actually fetch+parse`,
      );
    }
  }

  console.log(
    "\n=== Summary (per-query bytes fetched today = the largest single prefix shard for the language, per docs/concepts/index-format.md's sharding design) ===",
  );
  console.log(
    "docs\tbuildMs\tenShardCount\tlargestShardGzipBytes(en)\tlargestShardParseMs(en)",
  );
  for (const r of results) {
    const en = r.termShardStatsByLang.find((s) => s.lang === "en");
    console.log(
      `${r.count}\t${r.buildMs.toFixed(0)}\t${en?.shardCount ?? "n/a"}\t${en?.largestShardGzipBytes ?? "n/a"}\t${en?.largestShardParseMs?.toFixed(1) ?? "n/a"}`,
    );
  }

  console.log(
    "\nSee docs/concepts/binary-storage.md and docs/archive/roadmaps/implementation-history.md#phase-7--scale-options for interpretation.",
  );

  console.log(
    `\n${JSON.stringify({ commit: process.env.GITHUB_SHA ?? "local", results }, null, 2)}`,
  );
}

main();
