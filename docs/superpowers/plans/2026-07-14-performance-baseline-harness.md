# Performance Baseline Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish the first reproducible CMS-2k Chromium performance baseline with correctness-checked cold and warm lexical measurements, stable JSON evidence, and a reviewed Markdown report.

**Architecture:** Add a private `@ktjn/searchable-benchmark` workspace package that composes the existing deterministic fixtures, real indexer, built browser client, and Playwright Chromium. Keep workload identity, index measurement, loopback serving, browser measurement, report validation, atomic publication, and Markdown rendering as separate internal units; preserve the historical indexer scaling script unchanged.

**Tech Stack:** Node.js 24, TypeScript 7, pnpm 11, Vitest 4, Playwright Chromium, existing Searchable fixtures/indexer/client workspaces, SHA-256, loopback HTTP, JSON, Markdown.

## Global Constraints

- The full profile is exactly `generateCms2kCorpus({ count: 2000 })` with the fixture's default English/German split.
- The full profile uses one discarded warm-up and ten measured repetitions per cold query and warm query-set pass.
- The smoke profile uses 40 generated documents, one discarded warm-up, and two measured repetitions.
- Measure main-thread lexical search only with `worker: false` and `strict: true`.
- Preserve raw samples; calculate p50 and p95 with the nearest-rank rule over ascending finite non-negative samples.
- Every timed query must meet its fixed top-URL, total-hit, and facet expectations; fast incorrect output fails the run.
- Record actual local response-body bytes separately from deterministic level-9 gzip-equivalent artifact bytes.
- Warm measured passes must issue zero generated-index requests after the complete discarded warm-up pass.
- Heap unavailability is recorded explicitly with a reason; no missing measurement is replaced with zero.
- Full reviewed runs require a clean Git worktree. Smoke runs may use a dirty worktree and never publish reviewed artifacts.
- Raw timestamped reports are ignored; only `benchmark-results/cms-2k/reviewed-baseline.json` and `docs/project/performance-baseline.md` are reviewed publication artifacts.
- Introduce no threshold or CI gate, baseline comparison, ranking change,
  index-format change, public API, runtime dependency, or production bundle
  code.
- Leave `packages/indexer/bench/json-tier-scaling.mjs` unchanged.
- Move the approved design and this plan to `docs/archive/specs/performance-baseline-harness.md` and `docs/archive/plans/performance-baseline-harness.md` only after the reviewed baseline is complete.

---

## Planned file structure

### New private package

- `packages/benchmark/package.json` — private package metadata and baseline, smoke, render, test, build, and typecheck scripts.
- `packages/benchmark/tsconfig.json` — Node + DOM TypeScript build configuration.
- `packages/benchmark/src/types.ts` — workload, samples, artifact, browser, environment, and schema-version-1 report types.
- `packages/benchmark/src/config.ts` — immutable baseline/smoke profiles and validation.
- `packages/benchmark/src/statistics.ts` — nearest-rank p50/p95 summaries.
- `packages/benchmark/src/workload.ts` — deterministic CMS corpus/query definitions and canonical SHA-256 identity.
- `packages/benchmark/src/index-measurement.ts` — real index build/write timing and recursive raw/gzip artifact inventory.
- `packages/benchmark/src/server.ts` — allowlisted loopback server for the page, client modules, and index.
- `packages/benchmark/src/browser-measurement.ts` — Playwright cold/warm measurement and correctness enforcement.
- `packages/benchmark/src/report.ts` — schema validation, environment capture, serialization, and atomic JSON writes.
- `packages/benchmark/src/run.ts` — lifecycle orchestration and guaranteed cleanup.
- `packages/benchmark/src/cli.ts` — baseline/smoke CLI and concise console summary.
- `packages/benchmark/src/render.ts` — explicit report promotion and deterministic Markdown rendering.
- `packages/benchmark/src/render-cli.ts` — required report-path CLI.

### New tests

- `packages/benchmark/test/config.test.ts`
- `packages/benchmark/test/statistics.test.ts`
- `packages/benchmark/test/workload.test.ts`
- `packages/benchmark/test/index-measurement.test.ts`
- `packages/benchmark/test/server.test.ts`
- `packages/benchmark/test/browser-measurement.test.ts`
- `packages/benchmark/test/report.test.ts`
- `packages/benchmark/test/run.test.ts`
- `packages/benchmark/test/render.test.ts`

### Repository integration and publication

- Modify `package.json` — add `benchmark:baseline`, `benchmark:smoke`, and `benchmark:render` commands.
- Modify `.gitignore` — ignore timestamped benchmark results while allowing the reviewed JSON.
- Create `benchmark-results/cms-2k/reviewed-baseline.json` after the clean full run.
- Create `docs/project/performance-baseline.md` from the reviewed JSON.
- Modify `docs/project/roadmap.md` — record one published vertical baseline and preserve remaining work.
- Modify `showcase/test/docs-site.test.ts` — require the performance guide and exact interpretation boundaries.
- Move the design and plan into `docs/archive/` at completion.

---

### Task 1: Create the private package, fixed profiles, and statistics contract

**Files:**
- Create: `packages/benchmark/package.json`
- Create: `packages/benchmark/tsconfig.json`
- Create: `packages/benchmark/src/types.ts`
- Create: `packages/benchmark/src/config.ts`
- Create: `packages/benchmark/src/statistics.ts`
- Create: `packages/benchmark/test/config.test.ts`
- Create: `packages/benchmark/test/statistics.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: root workspace discovery from `pnpm-workspace.yaml`; TypeScript defaults from `tsconfig.base.json`.
- Produces: `BenchmarkConfig`, `BASELINE_CONFIG`, `SMOKE_CONFIG`, `validateConfig()`, `SampleSummary`, and `summarizeSamples()` for every later task.

- [ ] **Step 1: Write failing configuration and statistics tests**

Create tests with these exact contracts:

```ts
// packages/benchmark/test/config.test.ts
import { describe, expect, it } from "vitest";
import {
  BASELINE_CONFIG,
  SMOKE_CONFIG,
  validateConfig,
} from "../src/config.js";

describe("benchmark profiles", () => {
  it("pins the reviewed CMS-2k profile", () => {
    expect(BASELINE_CONFIG).toEqual({
      profile: "cms-2k",
      documentCount: 2000,
      warmupCount: 1,
      repeatCount: 10,
      requireCleanWorktree: true,
      headless: true,
    });
  });

  it("keeps smoke fast and non-publishing", () => {
    expect(SMOKE_CONFIG).toEqual({
      profile: "smoke",
      documentCount: 40,
      warmupCount: 1,
      repeatCount: 2,
      requireCleanWorktree: false,
      headless: true,
    });
  });

  it.each([
    [{ ...BASELINE_CONFIG, documentCount: 0 }, /documentCount/],
    [{ ...BASELINE_CONFIG, warmupCount: -1 }, /warmupCount/],
    [{ ...BASELINE_CONFIG, repeatCount: 0 }, /repeatCount/],
  ])("rejects invalid configuration %#", (value, message) => {
    expect(() => validateConfig(value)).toThrow(message);
  });
});
```

```ts
// packages/benchmark/test/statistics.test.ts
import { expect, it } from "vitest";
import { summarizeSamples } from "../src/statistics.js";

it("preserves samples and uses nearest-rank p50 and p95", () => {
  expect(summarizeSamples([10, 1, 9, 2, 8, 3, 7, 4, 6, 5])).toEqual({
    samples: [10, 1, 9, 2, 8, 3, 7, 4, 6, 5],
    p50: 5,
    p95: 10,
    min: 1,
    max: 10,
  });
});

it.each([[], [1, Number.NaN], [1, -1], [Number.POSITIVE_INFINITY]])(
  "rejects invalid samples %#",
  (samples) => expect(() => summarizeSamples(samples)).toThrow(),
);
```

- [ ] **Step 2: Run the tests and observe missing-module failures**

Run:

```bash
pnpm exec vitest run packages/benchmark/test/config.test.ts packages/benchmark/test/statistics.test.ts
```

Expected: FAIL because `src/config.ts` and `src/statistics.ts` do not exist.

- [ ] **Step 3: Add package metadata, types, profiles, and nearest-rank summaries**

Use this package shape:

```json
{
  "name": "@ktjn/searchable-benchmark",
  "version": "0.0.0",
  "private": true,
  "description": "Private reproducible performance evidence tooling for Searchable.",
  "license": "MIT",
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "baseline": "node dist/cli.js --profile cms-2k",
    "smoke": "node dist/cli.js --profile smoke",
    "render": "node dist/render-cli.js"
  },
  "dependencies": {
    "@ktjn/searchable-client": "workspace:*",
    "@ktjn/searchable-fixtures": "workspace:*",
    "@ktjn/searchable-indexer": "workspace:*"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.1",
    "@types/node": "^26.1.1",
    "typescript": "^7.0.2",
    "vitest": "^4.1.10"
  }
}
```

`tsconfig.json` extends `../../tsconfig.base.json`, sets `outDir: "dist"`,
`rootDir: "src"`, `types: ["node"]`, `lib: ["ES2022", "DOM"]`, and includes
`src`.

Define:

```ts
export type BenchmarkProfile = "cms-2k" | "smoke";

export interface BenchmarkConfig {
  profile: BenchmarkProfile;
  documentCount: number;
  warmupCount: number;
  repeatCount: number;
  requireCleanWorktree: boolean;
  headless: boolean;
}

export interface SampleSummary {
  samples: number[];
  p50: number;
  p95: number;
  min: number;
  max: number;
}
```

Implement `validateConfig()` with integer checks and `summarizeSamples()` with:

```ts
function nearestRank(sorted: readonly number[], percentile: number): number {
  const index = Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1);
  const value = sorted[index];
  if (value === undefined) throw new Error("sample set must be non-empty");
  return value;
}
```

Keep raw sample order in `samples`; sort a copy for aggregates.

Add root scripts:

```json
"prebenchmark:baseline": "pnpm build",
"benchmark:baseline": "pnpm --filter @ktjn/searchable-benchmark baseline",
"prebenchmark:smoke": "pnpm build",
"benchmark:smoke": "pnpm --filter @ktjn/searchable-benchmark smoke",
"prebenchmark:render": "pnpm build",
"benchmark:render": "pnpm --filter @ktjn/searchable-benchmark render"
```

- [ ] **Step 4: Verify package foundation**

Run:

```bash
pnpm install
pnpm exec vitest run packages/benchmark/test/config.test.ts packages/benchmark/test/statistics.test.ts
pnpm --filter @ktjn/searchable-benchmark typecheck
```

Expected: profile/statistics tests PASS and package typecheck PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml packages/benchmark
git commit -m "feat(benchmark): define baseline profiles"
```

---

### Task 2: Define the deterministic workload and correctness policy

**Files:**
- Create: `packages/benchmark/src/workload.ts`
- Create: `packages/benchmark/test/workload.test.ts`
- Modify: `packages/benchmark/src/types.ts`

**Interfaces:**
- Consumes: `BenchmarkConfig.documentCount`; `generateCms2kCorpus()`; public `SearchOptions` shape.
- Produces: `BenchmarkWorkload`, `BenchmarkQuery`, `createWorkload(config)`, `hashCanonical(value)`, and `assertExpectedResult(query, result)`.

- [ ] **Step 1: Write failing deterministic workload tests**

```ts
import { describe, expect, it } from "vitest";
import { BASELINE_CONFIG } from "../src/config.js";
import {
  BENCHMARK_QUERIES,
  assertExpectedResult,
  createWorkload,
} from "../src/workload.js";

describe("CMS benchmark workload", () => {
  it("has six fixed correctness-checked query classes", () => {
    expect(BENCHMARK_QUERIES.map(({ id }) => id)).toEqual([
      "single-term",
      "multi-term",
      "prefix",
      "no-match",
      "filtered",
      "faceted",
    ]);
  });

  it("generates a deterministic CMS-2k identity", () => {
    const left = createWorkload(BASELINE_CONFIG);
    const right = createWorkload(BASELINE_CONFIG);
    expect(left.documents).toHaveLength(2006);
    expect(left.corpusHash).toMatch(/^[a-f0-9]{64}$/);
    expect(left.querySetHash).toMatch(/^[a-f0-9]{64}$/);
    expect(right.corpusHash).toBe(left.corpusHash);
    expect(right.querySetHash).toBe(left.querySetHash);
  });

  it("rejects an incorrect timed result", () => {
    expect(() =>
      assertExpectedResult(BENCHMARK_QUERIES[0]!, {
        hits: [],
        totalHits: 0,
        language: "en",
      }),
    ).toThrow(/single-term/);
  });
});
```

- [ ] **Step 2: Run the workload test and observe failure**

Run:

```bash
pnpm exec vitest run packages/benchmark/test/workload.test.ts
```

Expected: FAIL because `src/workload.ts` does not exist.

- [ ] **Step 3: Implement the exact six-query workload**

Add these types:

```ts
export interface ExpectedSearchResult {
  topUrl?: string;
  totalHits: number;
  facetValues?: Array<{ value: string; count: number; selected: boolean }>;
}

export interface BenchmarkQuery {
  id: string;
  query: string;
  options: {
    limit: number;
    filters?: Record<string, string | string[]>;
    facets?: string[];
  };
  expected: ExpectedSearchResult;
}

export interface BenchmarkWorkload {
  documents: Array<{ id: number; url: string; html: string }>;
  corpusHash: string;
  querySetHash: string;
  queries: BenchmarkQuery[];
  languageCounts: Record<string, number>;
}
```

`createWorkload()` selects exact expectations by profile. The smoke profile has
46 total documents and uses these expectation changes while preserving every
query string, option, and top URL from the full profile:

```ts
const SMOKE_TOTAL_HITS = {
  "single-term": 3,
  "multi-term": 3,
  prefix: 3,
  "no-match": 0,
  filtered: 5,
  faceted: 15,
} as const;

const SMOKE_CATEGORY_FACETS = [
  { value: "Company", count: 3, selected: false },
  { value: "Engineering", count: 5, selected: false },
  { value: "Guides", count: 3, selected: false },
  { value: "Product", count: 2, selected: false },
];
```

Define the query contracts exactly:

```ts
export const BENCHMARK_QUERIES: readonly BenchmarkQuery[] = [
  {
    id: "single-term",
    query: "benchmark",
    options: { limit: 10 },
    expected: {
      topUrl: "/en/engineering/engineering-scaling-regression-testing-7.html",
      totalHits: 125,
    },
  },
  {
    id: "multi-term",
    query: "static shard hosting",
    options: { limit: 10 },
    expected: {
      topUrl: "/en/guides/guides-how-to-configure-progressive-feature-adoption-10.html",
      totalHits: 125,
    },
  },
  {
    id: "prefix",
    query: "bench*",
    options: { limit: 10 },
    expected: {
      topUrl: "/en/engineering/engineering-scaling-regression-testing-7.html",
      totalHits: 125,
    },
  },
  {
    id: "no-match",
    query: "zzzz-no-match",
    options: { limit: 10 },
    expected: { totalHits: 0 },
  },
  {
    id: "filtered",
    query: "search",
    options: { limit: 10, filters: { category: "Engineering" } },
    expected: {
      topUrl: "/en/engineering/engineering-scaling-regression-testing-7.html",
      totalHits: 250,
    },
  },
  {
    id: "faceted",
    query: "search",
    options: { limit: 10, facets: ["category"] },
    expected: {
      topUrl: "/en/product/product-a-closer-look-at-opt-in-search-features-20.html",
      totalHits: 627,
      facetValues: [
        { value: "Company", count: 125, selected: false },
        { value: "Engineering", count: 250, selected: false },
        { value: "Guides", count: 125, selected: false },
        { value: "Product", count: 125, selected: false },
      ],
    },
  },
];
```

Canonicalize document identity as ordered `[id, url, html]` tuples and query
identity as the JSON-compatible query array. Hash UTF-8 JSON with SHA-256. Count
languages from each document's `<html lang>` attribute and fail if any document
lacks one. `assertExpectedResult()` must compare exact `totalHits`, optional top
URL, and optional category facet values.

- [ ] **Step 4: Verify deterministic workload**

Run:

```bash
pnpm exec vitest run packages/benchmark/test/workload.test.ts
pnpm --filter @ktjn/searchable-benchmark typecheck
```

Expected: workload tests PASS and typecheck PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/benchmark/src packages/benchmark/test/workload.test.ts
git commit -m "feat(benchmark): define CMS workload"
```

---

### Task 3: Measure the real index and artifact inventory

**Files:**
- Create: `packages/benchmark/src/index-measurement.ts`
- Create: `packages/benchmark/test/index-measurement.test.ts`
- Modify: `packages/benchmark/src/types.ts`

**Interfaces:**
- Consumes: workload documents; `buildIndex()`; `writeIndex()`; an existing temporary output directory.
- Produces: `measureIndex(documents, generationMs, outputDirectory): Promise<IndexMeasurement>` and `ArtifactMeasurement` entries keyed by manifest-relative path.

- [ ] **Step 1: Write failing index measurement tests**

Use a three-document generated workload in a temporary directory and assert:

```ts
const measurement = await measureIndex(documents, generationMs, directory);
expect(measurement.documentCount).toBe(documents.length);
expect(measurement.generationMs).toBeGreaterThanOrEqual(0);
expect(measurement.buildMs).toBeGreaterThanOrEqual(0);
expect(measurement.writeMs).toBeGreaterThanOrEqual(0);
expect(measurement.totalRawBytes).toBeGreaterThan(0);
expect(measurement.totalGzipBytes).toBeGreaterThan(0);
expect(measurement.manifestRawBytes).toBeGreaterThan(0);
expect(measurement.fileCount).toBe(measurement.artifacts.length);
expect(measurement.artifacts.map(({ path }) => path)).toEqual(
  [...measurement.artifacts.map(({ path }) => path)].sort(),
);
expect(measurement.artifacts).toContainEqual(
  expect.objectContaining({ path: "manifest.json" }),
);
```

Also write a fixture-directory test for recursive inventory ordering and
level-9 gzip equivalence using `gzipSync(bytes, { level: 9 }).length`.

- [ ] **Step 2: Run the test and observe missing implementation**

```bash
pnpm exec vitest run packages/benchmark/test/index-measurement.test.ts
```

Expected: FAIL because `measureIndex()` does not exist.

- [ ] **Step 3: Implement index and artifact measurements**

Define:

```ts
export interface ArtifactMeasurement {
  path: string;
  rawBytes: number;
  gzipBytes: number;
}

export interface IndexMeasurement {
  documentCount: number;
  generationMs: number;
  buildMs: number;
  writeMs: number;
  totalRawBytes: number;
  totalGzipBytes: number;
  manifestRawBytes: number;
  fileCount: number;
  shardCount: number;
  artifacts: ArtifactMeasurement[];
}
```

Pass `generationMs` into `measureIndex` rather than timing corpus creation a
second time. Time only `buildIndex` and `writeIndex`. Recursively read emitted
files, normalize paths to `/`, gzip bytes at level 9, sort by path, and sum.
Parse `manifest.json` to count all arrays under `manifest.shards` without
assuming only today's shard categories. Do not modify output files.

- [ ] **Step 4: Verify artifact measurement**

```bash
pnpm exec vitest run packages/benchmark/test/index-measurement.test.ts
pnpm --filter @ktjn/searchable-benchmark typecheck
```

Expected: index measurement tests PASS and typecheck PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/benchmark/src packages/benchmark/test/index-measurement.test.ts
git commit -m "feat(benchmark): measure index artifacts"
```

---

### Task 4: Add the allowlisted loopback benchmark server

**Files:**
- Create: `packages/benchmark/src/server.ts`
- Create: `packages/benchmark/test/server.test.ts`

**Interfaces:**
- Consumes: absolute generated-index directory and built `packages/client/dist` directory.
- Produces: `serveBenchmark({ indexDirectory, clientDirectory }): Promise<BenchmarkServer>` with `baseUrl`, `indexUrl`, and idempotent `close()`.

- [ ] **Step 1: Write failing server security and content tests**

Create temporary index/client files and assert:

```ts
const server = await serveBenchmark({ indexDirectory, clientDirectory });
expect(await fetch(server.baseUrl).then((r) => r.text())).toContain(
  "window.searchableBenchmark",
);
expect(await fetch(server.indexUrl).then((r) => r.json())).toEqual({ ok: true });
expect(
  await fetch(new URL("client/index.js", server.baseUrl)).then((r) => r.text()),
).toContain("SearchClient");
expect((await fetch(new URL("missing", server.baseUrl))).status).toBe(404);
expect(
  await requestStatus(server.baseUrl, "/index/%2e%2e/client/index.js"),
).toBe(403);
await server.close();
await server.close();
```

- [ ] **Step 2: Run and observe the missing server**

```bash
pnpm exec vitest run packages/benchmark/test/server.test.ts
```

Expected: FAIL because `serveBenchmark()` does not exist.

- [ ] **Step 3: Implement a three-root loopback server**

Bind an ephemeral port on `127.0.0.1`. Allow only:

- `/` -> generated benchmark HTML;
- `/client/<relative path>` -> resolved descendants of `clientDirectory`; and
- `/index/<relative path>` -> resolved descendants of `indexDirectory`.

Use a `requestStatus()` test helper built on `node:http.request` so the client
does not normalize dot segments before sending. Reject decoded traversal before
URL path normalization or file resolution. Return JavaScript, JSON, HTML, and
octet-stream content types. The HTML must install this browser API:

```ts
window.searchableBenchmark = {
  async initialize(indexUrl) {
    const started = performance.now();
    this.client = new SearchClient({
      indexUrl,
      worker: false,
      strict: true,
    });
    await this.client.ready();
    return performance.now() - started;
  },
  async search(query, options) {
    const started = performance.now();
    const result = await this.client.search(query, options);
    return { durationMs: performance.now() - started, result };
  },
  heap() {
    const memory = performance.memory;
    return memory && Number.isFinite(memory.usedJSHeapSize)
      ? { status: "available", usedBytes: memory.usedJSHeapSize }
      : { status: "unavailable", reason: "performance.memory unavailable" };
  },
  dispose() {
    this.client?.dispose();
    this.client = undefined;
  },
};
```

Import `SearchClient` from `/client/index.js` in a module script. Close sockets
and the HTTP server idempotently.

- [ ] **Step 4: Verify server behavior**

```bash
pnpm exec vitest run packages/benchmark/test/server.test.ts
pnpm --filter @ktjn/searchable-benchmark typecheck
```

Expected: server tests PASS and typecheck PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/benchmark/src/server.ts packages/benchmark/test/server.test.ts
git commit -m "feat(benchmark): serve browser workload safely"
```

---

### Task 5: Measure correctness-checked cold and warm Chromium search

**Files:**
- Create: `packages/benchmark/src/browser-measurement.ts`
- Create: `packages/benchmark/test/browser-measurement.test.ts`
- Modify: `packages/benchmark/src/types.ts`

**Interfaces:**
- Consumes: validated config, fixed queries, `BenchmarkServer`, and index artifact inventory.
- Produces: `measureBrowser(options): Promise<BrowserMeasurement>` containing Chromium version, heap status, cold per-query samples, warm per-query samples, whole-pass samples, and observed index transfers.

- [ ] **Step 1: Write the failing end-to-end smoke test**

Build a smoke index in a temporary directory, serve the built client and index,
then assert:

```ts
const result = await measureBrowser({
  config: SMOKE_CONFIG,
  queries: workload.queries,
  server,
  artifacts: index.artifacts,
});
expect(result.browser.name).toBe("chromium");
expect(result.browser.version).toMatch(/\d+/);
expect(result.cold).toHaveLength(6);
for (const query of result.cold) {
  expect(query.initialize.samples).toHaveLength(2);
  expect(query.firstQuery.samples).toHaveLength(2);
  expect(query.combined.samples).toHaveLength(2);
  expect(query.transfers).toHaveLength(2);
}
expect(result.warm.wholePass.samples).toHaveLength(2);
expect(result.warm.indexRequestCount).toBe(0);
expect(result.warm.queries).toHaveLength(6);
```

Provide smoke-specific expected results derived from the same query-definition
factory rather than weakening correctness checks. Add a test that mutates one
expected top URL and observes a query-ID-specific rejection. Add a test that
injects a warm `/index/` response and observes `/unexpected warm network/`.

- [ ] **Step 2: Run the smoke test and observe failure**

```bash
pnpm exec vitest run packages/benchmark/test/browser-measurement.test.ts
```

Expected: FAIL because browser measurement is missing.

- [ ] **Step 3: Implement cold measurement**

Launch Chromium once with:

```ts
chromium.launch({
  headless: config.headless,
  args: ["--enable-precise-memory-info"],
});
```

For each query, perform `warmupCount + repeatCount` fresh-context runs. Attach a
response observer before `page.goto()`, count only `/index/` successful
responses, and read `response.body().byteLength`. Map each index path to its
artifact gzip bytes and fail if a fetched path has no artifact. In the page:

1. initialize a new strict main-thread client;
2. capture heap after initialization;
3. time exactly one query;
4. return the result and heap after first query;
5. enforce correctness in Node; and
6. dispose and close the context in `finally`.

Discard warm-up samples; summarize initialization, first-query, combined, raw
bytes, gzip-equivalent bytes, and request count independently per query.

- [ ] **Step 4: Implement warm measurement**

Create one fresh context/client. Run the complete query set once per discarded
warm-up pass, enforcing correctness. Clear the request observer after warm-up.
For each measured pass, time every query separately and the complete ordered
set, enforce correctness, and fail if any `/index/` request appears. Capture
heap after initialization and after the final warm pass. Preserve all samples
and summarize each query and whole-pass duration.

Define heap as:

```ts
export type HeapMeasurement =
  | { status: "available"; usedBytes: number }
  | { status: "unavailable"; reason: string };

export interface TransferSample {
  requestCount: number;
  rawBytes: number;
  gzipBytes: number;
  paths: string[];
}

export interface ColdQueryMeasurement {
  id: string;
  initialize: SampleSummary;
  firstQuery: SampleSummary;
  combined: SampleSummary;
  requestCount: SampleSummary;
  rawBytes: SampleSummary;
  gzipBytes: SampleSummary;
  transfers: TransferSample[];
  heapAfterInitialize: HeapMeasurement[];
  heapAfterQuery: HeapMeasurement[];
}

export interface WarmQueryMeasurement {
  id: string;
  duration: SampleSummary;
}

export interface WarmMeasurement {
  wholePass: SampleSummary;
  queries: WarmQueryMeasurement[];
  indexRequestCount: 0;
  heapAfterInitialize: HeapMeasurement;
  heapAfterFinalPass: HeapMeasurement;
}

export interface BrowserMeasurement {
  browser: { name: "chromium"; version: string };
  cold: ColdQueryMeasurement[];
  warm: WarmMeasurement;
}
```

Never coerce unavailable heap to zero. Always close page, context, and browser
in `finally` blocks.

- [ ] **Step 5: Verify browser measurement**

```bash
pnpm build
pnpm exec vitest run packages/benchmark/test/browser-measurement.test.ts
pnpm --filter @ktjn/searchable-benchmark typecheck
```

Expected: Playwright smoke, incorrect-result, and warm-network tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/benchmark/src packages/benchmark/test/browser-measurement.test.ts
git commit -m "feat(benchmark): measure Chromium search"
```

---

### Task 6: Validate, write, and orchestrate schema-version-1 reports

**Files:**
- Create: `packages/benchmark/src/report.ts`
- Create: `packages/benchmark/src/run.ts`
- Create: `packages/benchmark/src/cli.ts`
- Create: `packages/benchmark/test/report.test.ts`
- Create: `packages/benchmark/test/run.test.ts`
- Modify: `packages/benchmark/src/types.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: config, workload, index measurement, server, browser measurement.
- Produces: `BenchmarkReportV1`, `validateReport()`, `captureEnvironment()`, `writeReportAtomic()`, `runBenchmark()`, and executable baseline/smoke CLI behavior.

- [ ] **Step 1: Write failing report validation and atomic-write tests**

Use a complete small report fixture and assert:

```ts
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
    cold: [{ ...report.cold[0], firstQuery: { samples: [Number.NaN] } }],
  }),
).toThrow(/finite/);
```

For atomic writes, mock or inject `writeFile`, `rename`, and `rm`; assert the
temporary sibling is validated/written before rename and removed when rename
throws.

- [ ] **Step 2: Write failing lifecycle cleanup tests**

Inject dependencies into `runBenchmark()` and force failure after server start
and after browser launch. Assert server close and temporary-directory removal
each run once, no final report exists, and the original error survives.

- [ ] **Step 3: Run report/lifecycle tests and observe failure**

```bash
pnpm exec vitest run packages/benchmark/test/report.test.ts packages/benchmark/test/run.test.ts
```

Expected: FAIL because report/orchestration modules are missing.

- [ ] **Step 4: Define and validate the complete report**

`BenchmarkReportV1` must contain:

```ts
interface BenchmarkReportV1 {
  schemaVersion: 1;
  run: {
    startedAt: string;
    completedInMs: number;
    commit: string;
    dirty: boolean;
    profile: "cms-2k" | "smoke";
    timingMethod: "performance.now";
    warmupCount: number;
    repeatCount: number;
  };
  environment: {
    platform: string;
    release: string;
    architecture: string;
    cpuModel: string;
    logicalCpuCount: number;
    nodeVersion: string;
    pnpmVersion: string;
    playwrightVersion: string;
    chromiumVersion: string;
    headless: boolean;
    launchFlags: string[];
  };
  corpus: {
    generator: "generateCms2kCorpus";
    documentCount: number;
    languageCounts: Record<string, number>;
    sha256: string;
  };
  index: IndexMeasurement;
  queries: {
    id: "cms-2k-lexical-v1";
    sha256: string;
    definitions: Array<BenchmarkQuery & { sha256: string }>;
  };
  cold: ColdQueryMeasurement[];
  warm: WarmMeasurement;
}
```

Hand-validate every required object/array/string/count/hash/date/sample. Reuse
`summarizeSamples()` to recalculate and compare all aggregates. Require the
query-set hash to match its complete canonical definitions, each definition's
hash to match that query, cold and warm query IDs to exactly match definition
IDs, and sample lengths to equal `run.repeatCount`. Require
`warm.indexRequestCount === 0`.

Capture Git state with non-interactive `git rev-parse HEAD` and
`git status --porcelain`; capture pnpm with `pnpm --version`; obtain Playwright
and Chromium versions from the installed package and launched browser. Reject a
dirty full run before corpus generation.

- [ ] **Step 5: Implement atomic output and lifecycle orchestration**

Write JSON as `${JSON.stringify(report, null, 2)}\n` to a temporary sibling with
exclusive creation, rename to the timestamped destination, reject an existing
destination, and remove the sibling in `finally`.
Format timestamp filenames by replacing `:` and `.` with `-` and append the
first seven commit characters.

`runBenchmark()` must create one unique temporary directory, measure generation,
index, server, and browser phases in order, validate the complete report, write
only after successful validation, and clean server/temp resources in `finally`.
Return `{ report, outputPath }` for the CLI.

The CLI accepts only `--profile cms-2k|smoke`, rejects unknown options, resolves
the repository root from `import.meta.url`, and prints output path plus corpus,
index, cold p50/p95, warm p50/p95, transfer, and heap-status summaries.

Update `.gitignore`:

```gitignore
/benchmark-results/*
!/benchmark-results/cms-2k/
/benchmark-results/cms-2k/*
!/benchmark-results/cms-2k/reviewed-baseline.json
```

- [ ] **Step 6: Verify reports and smoke command**

```bash
pnpm exec vitest run packages/benchmark/test/report.test.ts packages/benchmark/test/run.test.ts
pnpm benchmark:smoke
pnpm --filter @ktjn/searchable-benchmark typecheck
git status --short
```

Expected: tests PASS; smoke writes only an ignored timestamped JSON report;
tracked status contains only intended source/test changes.

- [ ] **Step 7: Commit**

```bash
git add .gitignore packages/benchmark/src packages/benchmark/test
git commit -m "feat(benchmark): emit validated reports"
```

---

### Task 7: Promote explicit reports and render published Markdown

**Files:**
- Create: `packages/benchmark/src/render.ts`
- Create: `packages/benchmark/src/render-cli.ts`
- Create: `packages/benchmark/test/render.test.ts`

**Interfaces:**
- Consumes: one explicit validated schema-version-1 JSON path.
- Produces: `promoteAndRender(reportPath, repositoryRoot)` that atomically writes reviewed JSON and deterministic Markdown.

- [ ] **Step 1: Write failing renderer and promotion tests**

Build a report fixture with fixed environment/metrics and assert the renderer
contains:

```ts
expect(markdown).toContain("# Performance baseline");
expect(markdown).toContain("CMS-2k Chromium vertical baseline");
expect(markdown).toContain("10 measured repetitions");
expect(markdown).toContain("p50");
expect(markdown).toContain("p95");
expect(markdown).toContain("gzip-equivalent");
expect(markdown).toContain("not a performance budget");
expect(markdown).toContain("not a supported operating range");
expect(markdown).toContain(reportSha256);
```

Assert `promoteAndRender()` rejects smoke reports, unknown schema versions, and
missing input. An input already equal to the reviewed destination is valid: skip
the JSON copy and regenerate Markdown from that validated file. Inject a rename
failure and verify rollback restores both previous stable artifacts.

- [ ] **Step 2: Run tests and observe the missing renderer failure**

```bash
pnpm exec vitest run packages/benchmark/test/render.test.ts
```

Expected: FAIL because the renderer does not exist.

- [ ] **Step 3: Implement explicit promotion and deterministic rendering**

`promoteAndRender()` must:

1. read the explicit input and validate it;
2. require `run.profile === "cms-2k"` and `run.dirty === false`;
3. hash the exact input bytes with SHA-256;
4. render Markdown only from the parsed validated report;
5. stage reviewed JSON and Markdown as temporary siblings;
6. move existing stable artifacts to temporary backups;
7. rename both staged files only after both writes succeed;
8. restore both backups and remove any newly promoted file if either rename
   fails; and
9. remove temporary siblings/backups in `finally` after success.

Render sections for workload, environment, index build/output, cold per-query
latency/transfers, warm per-query and whole-pass latency, heap status,
reproduction, definitions, and interpretation limits. Keep numeric precision
honest: milliseconds to two decimals for display, bytes as exact integers plus
human-readable units, raw JSON unchanged.

If input is already the stable reviewed JSON path, do not replace or back up the
JSON; render and atomically replace Markdown only. `render-cli.ts` requires
exactly one positional report path and calls
`promoteAndRender()` using the repository root resolved from `import.meta.url`.

- [ ] **Step 4: Verify renderer against a temporary repository root**

```bash
pnpm exec vitest run packages/benchmark/test/render.test.ts
pnpm --filter @ktjn/searchable-benchmark typecheck
```

Expected: renderer tests PASS.

- [ ] **Step 5: Commit the green renderer slice**

```bash
git add packages/benchmark/src packages/benchmark/test
git commit -m "feat(benchmark): render reviewed baseline"
```

---

### Task 8: Run, review, publish, and archive the CMS-2k baseline

**Files:**
- Create: `benchmark-results/cms-2k/reviewed-baseline.json`
- Create: `docs/project/performance-baseline.md`
- Modify: `docs/project/roadmap.md`
- Move: `docs/superpowers/specs/2026-07-14-performance-baseline-harness-design.md` -> `docs/archive/specs/performance-baseline-harness.md`
- Move: `docs/superpowers/plans/2026-07-14-performance-baseline-harness.md` -> `docs/archive/plans/performance-baseline-harness.md`
- Test: `showcase/test/docs-site.test.ts`

**Interfaces:**
- Consumes: clean committed full harness, explicit ignored raw report, promotion renderer.
- Produces: reviewed raw evidence, public guide, truthful roadmap status, archived implementation records.

- [ ] **Step 1: Make the implementation worktree clean before measurement**

Run:

```bash
git status --short
pnpm lint
pnpm build
pnpm typecheck
pnpm --filter @ktjn/searchable-benchmark test
```

Expected: empty status and all focused gates PASS. If status is not empty,
commit only intentional implementation changes before continuing.

Then verify no prior unreviewed full-run candidate can be confused with this
run:

```powershell
$candidates = @(
  Get-ChildItem benchmark-results/cms-2k -Filter *.json -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne 'reviewed-baseline.json' }
)
if ($candidates.Count -ne 0) {
  throw 'Resolve existing unreviewed CMS-2k reports before the reviewed run'
}
```

- [ ] **Step 2: Run the full baseline exactly once on the clean checkout**

```bash
pnpm benchmark:baseline
```

Expected: six correctness-checked cold series and one warm series complete; an
ignored timestamped report path is printed; no tracked file changes.

- [ ] **Step 3: Inspect raw evidence before promotion**

Resolve the only candidate rather than choosing a newest report implicitly:

```powershell
$candidates = @(
  Get-ChildItem benchmark-results/cms-2k -Filter *.json |
    Where-Object { $_.Name -ne 'reviewed-baseline.json' }
)
if ($candidates.Count -ne 1) { throw "Expected one candidate, found $($candidates.Count)" }
$reportPath = $candidates[0].FullName
$report = Get-Content -Raw -LiteralPath $reportPath | ConvertFrom-Json
```

Check that exact parsed report. Confirm:

- schema version `1`, profile `cms-2k`, dirty `false`, repeats `10`;
- exactly 2,008 documents and six queries;
- every cold query contains 10 initialize/query/combined/transfer samples;
- warm contains 10 whole-pass samples and zero index requests;
- all correctness expectations passed;
- raw/gzip byte totals equal the artifact sums;
- environment and Chromium versions are populated; and
- heap is either valid non-negative bytes or explicit unavailable status.

Do not rerun merely to seek better numbers. Rerun only after identifying a
measurement defect, and document why the rejected run was invalid.

- [ ] **Step 4: Add the failing public documentation policy**

Extend `showcase/test/docs-site.test.ts` to require the future page's title,
commands, reviewed JSON link, cold/warm definitions, p50/p95, gzip-equivalent
definition, heap caveat, no-budget language, and remaining-work language.

Run:

```bash
pnpm exec vitest run showcase/test/docs-site.test.ts
```

Expected: FAIL because `docs/project/performance-baseline.md` does not exist.

- [ ] **Step 5: Promote that exact report and rerun documentation policy**

```powershell
$candidates = @(
  Get-ChildItem benchmark-results/cms-2k -Filter *.json |
    Where-Object { $_.Name -ne 'reviewed-baseline.json' }
)
if ($candidates.Count -ne 1) { throw "Expected one candidate, found $($candidates.Count)" }
$reportPath = $candidates[0].FullName
pnpm benchmark:render -- $reportPath
pnpm exec vitest run packages/benchmark/test/render.test.ts showcase/test/docs-site.test.ts
```

Expected: stable reviewed JSON and Markdown are created; renderer and showcase
policy tests PASS.

- [ ] **Step 6: Review the rendered baseline against raw JSON**

Manually verify every table value, report hash, environment field, query label,
command, definition, heap caveat, and interpretation boundary. The guide must
say that this is one machine, one Chromium version, one corpus size, one
main-thread lexical profile, not a budget or supported operating range.

- [ ] **Step 7: Update roadmap without overclaiming**

Change the performance status to one published CMS-2k Chromium vertical
baseline. Keep these explicitly open:

- multiple sizes and deployment classes;
- Firefox/WebKit and low-end mobile;
- worker, Service Worker, and browser-cache-warm modes;
- prefix/fuzzy/phrase/facet/vector/hybrid expansion beyond this six-query slice;
- supported operating ranges, shard guidance, warning thresholds; and
- CI benchmark comparison/enforcement.

Do not mark performance-and-scale evidence complete.

- [ ] **Step 8: Archive approved records**

Use `git mv` for the approved design and plan. Add an archive note to each file
naming branch `feat/performance-baseline-harness`, the reviewed JSON path, and
`docs/project/performance-baseline.md`. Verify:

```bash
git ls-files docs/superpowers
```

Expected: no tracked files remain under `docs/superpowers`.

- [ ] **Step 9: Run four-phase doc review and commit evidence**

Apply the `doc-review` skill to the reviewed JSON link, rendered guide, roadmap,
commands, metrics, hashes, archive records, and ADR rationale. Then run:

```bash
pnpm lint
pnpm build
pnpm typecheck
pnpm --filter @ktjn/searchable-benchmark test
pnpm docs:check
git diff --check
```

Expected: all commands PASS and doc review has zero blockers. Commit:

```bash
git add benchmark-results/cms-2k/reviewed-baseline.json docs packages/benchmark showcase/test/docs-site.test.ts package.json pnpm-lock.yaml .gitignore
git commit -m "docs: publish CMS-2k performance baseline"
```

---

### Task 9: Full verification, review, and publication

**Files:**
- Review all files changed from `main`.

**Interfaces:**
- Consumes: complete implementation and reviewed baseline.
- Produces: verified draft pull request against `main` with honest measurement and scope evidence.

- [ ] **Step 1: Re-run the focused benchmark gates without replacing evidence**

```bash
pnpm --filter @ktjn/searchable-benchmark test
pnpm benchmark:smoke
pnpm benchmark:render -- benchmark-results/cms-2k/reviewed-baseline.json
git diff --exit-code benchmark-results/cms-2k/reviewed-baseline.json docs/project/performance-baseline.md
```

Expected: package tests and smoke PASS; rendering the reviewed report is
idempotent and produces no tracked diff. Do not rerun the full baseline.

- [ ] **Step 2: Run the complete repository matrix**

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm build
pnpm typecheck
pnpm test
pnpm size
pnpm docs:check
git diff --check
```

Expected: every command exits zero.

- [ ] **Step 3: Verify repository truth**

```bash
git status --short
git ls-files docs/superpowers
git log --oneline --decorate -12
```

Expected: clean worktree, no tracked internal plan files, and intentional
task-level commits.

- [ ] **Step 4: Request review and address findings**

Use `superpowers:requesting-code-review` against `main...HEAD`. Review especially:

- benchmark code must not enter published packages or bundle paths;
- clean-run enforcement and atomic promotion cannot publish partial evidence;
- cold caches/contexts and warm no-network semantics match the design;
- every metric is derived from real samples and finite values;
- browser responses count only generated-index paths;
- correctness assertions remain exact;
- cleanup covers every failure boundary; and
- docs do not imply budgets, broad browser support, or production operating
  ranges.

Fix all critical and important findings and rerun Steps 1-3.

- [ ] **Step 5: Push and open a draft PR**

Use `github:yeet` to push `feat/performance-baseline-harness` and open a draft
PR against `main`. The PR body must include:

- exact corpus, query set, cold/warm definitions, and repetition counts;
- reviewed report and guide paths plus the report SHA-256;
- summarized index, latency, transfer, and heap results;
- environment/hardware/Chromium metadata;
- correctness and warm-no-network results;
- full verification and doc/spec review results;
- explicit no-threshold/no-CI-gate/no-runtime-change boundary; and
- no-ADR rationale because the package is private measurement tooling.

Keep the worktree alive for PR feedback. Do not mark the draft ready or merge
without maintainer instruction.
