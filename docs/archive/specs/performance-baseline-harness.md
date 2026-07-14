# Performance Baseline Harness Design

Status: Archived after implementation

Date: 2026-07-14

Implemented on branch `feat/performance-baseline-harness`. The reviewed output
is preserved in
[`benchmark-results/cms-2k/reviewed-baseline.json`](../../../benchmark-results/cms-2k/reviewed-baseline.json)
and published as the [performance baseline](../../project/performance-baseline.md).

## Purpose

Create the first reproducible vertical performance baseline for Searchable. The
harness measures the real indexer and browser client against the deterministic
2,000-document CMS fixture, preserves raw machine-readable evidence, and
publishes a reviewed human-readable baseline. It supplies evidence for later
scale guidance without introducing performance budgets, regression thresholds,
or CI gates.

## Context

The repository already has three useful foundations:

- `@ktjn/searchable-fixtures` generates a deterministic CMS-shaped corpus;
- `packages/indexer/bench/json-tier-scaling.mjs` records one-shot Node index
  scaling evidence for the historical JSON-versus-binary investigation; and
- Playwright browser tests exercise the real `SearchClient` against static
  index files.

The current indexer benchmark does not own browser measurements, repeated
samples, a stable report schema, or a reviewed published report. It remains
unchanged as historical scaling evidence. The new harness is a separate,
private workspace package so benchmark-only dependencies and measurement code
cannot enter production packages or bundle budgets.

## Scope

The first baseline covers one deployment profile:

- the deterministic 2,000 generated-document CMS corpus;
- English and German content using the fixture's existing default split;
- the real `buildIndex()` and `writeIndex()` pipeline;
- Chromium through the repository's installed Playwright version;
- main-thread lexical search through the public `SearchClient` API;
- cold initialization plus first-query measurements;
- engine-warm query measurements;
- raw and gzip-equivalent index sizes, file and request counts, latency, bytes
  read, and Chromium heap where supported; and
- correctness assertions for every timed query.

The following are explicitly outside this slice:

- pass/fail performance budgets or comparisons with an earlier run;
- required CI benchmark execution;
- Firefox or WebKit baselines;
- workers, Service Workers, offline-cache behavior, or browser-cache-warm mode;
- vector or hybrid search;
- low-end mobile throttling;
- ranking, index-format, sharding, loading, or public API changes; and
- changes to the existing JSON-tier scaling script.

## Architecture

Add a private `@ktjn/searchable-benchmark` workspace package under
`packages/benchmark`. It depends on the private fixtures package and the public
indexer and client workspaces, but it is never published and exports no public
API.

The package has five internal boundaries:

1. **Configuration and query definitions** declare the corpus profile,
   repetitions, browser mode, and correctness expectations.
2. **Indexer measurement** generates the corpus, builds and writes the real
   index to a temporary directory, hashes corpus identity, and measures output
   files.
3. **Static serving and browser measurement** expose the generated index and a
   small benchmark page, run Chromium, and collect cold and warm samples.
4. **Report validation and serialization** produce a schema-versioned JSON
   document and reject incomplete or non-finite measurements.
5. **Rendering** converts one explicitly selected JSON report into the reviewed
   Markdown baseline.

The root package provides maintainer commands while the private package owns
their implementation.

## Commands and artifacts

The maintainer surface is:

```text
pnpm benchmark:baseline
pnpm benchmark:render -- <report-path>
pnpm benchmark:smoke
```

`benchmark:baseline` builds required workspaces, runs the full CMS-2k profile,
writes a raw JSON report, and prints a concise console summary. The output path
uses UTC time and the short commit identifier, for example:

```text
benchmark-results/cms-2k/2026-07-14T08-30-00Z-727839e.json
```

The reviewed raw baseline is copied to a stable checked-in path:

```text
benchmark-results/cms-2k/reviewed-baseline.json
```

`benchmark:render` accepts an explicit report path, validates it, atomically
copies it to `reviewed-baseline.json`, and renders the published summary at
`docs/project/performance-baseline.md` from that stable copy. It never discovers
the newest report implicitly. The summary records the reviewed report path and
content hash so the reviewed prose cannot silently refer to a different run.

`benchmark:smoke` uses a small corpus, one discarded warm-up, and two measured
repetitions. It proves the full Node-to-browser data path without establishing
performance evidence. Unit and smoke tests may run in CI; the full CMS-2k
baseline remains an explicit maintainer operation.

Unreviewed timestamped reports are ignored by Git. The stable reviewed JSON and
Markdown baseline are tracked.

## Corpus and query identity

The harness calls `generateCms2kCorpus({ count: 2000 })` with the generator's
default English/German languages. It computes a SHA-256 identity over a
canonical sequence of document IDs, URLs, and HTML. The report records:

- generator package and configuration;
- generated document count and per-language counts;
- corpus SHA-256;
- index configuration, including format and sharding settings; and
- the query-set identifier and SHA-256.

The initial query set is fixed and versioned. It includes:

- a single-term query;
- a multi-term query;
- a prefix query;
- a no-match query;
- a category-filtered query; and
- a faceted query.

Each query declares its options, expected top URL when applicable, and an
expected hit-count range. Query definitions use stable fixture content rather
than dynamically selecting whatever currently ranks first. Any correctness
failure aborts the run; fast but incorrect search is not benchmark evidence.

## Measurement contract

### Repetitions

The full profile uses one discarded warm-up followed by ten measured
repetitions. Samples are preserved in the raw report. Aggregates use the nearest
rank percentile rule over ascending samples and report at least median and p95.
Durations use `performance.now()` and are serialized in milliseconds without
rounding the raw samples.

### Indexer measurements

The Node phase records:

- corpus generation duration;
- `buildIndex()` duration;
- `writeIndex()` duration;
- total raw and gzip-equivalent bytes;
- manifest bytes;
- file and shard counts; and
- per-shard raw and gzip-equivalent sizes.

Gzip-equivalent size uses deterministic level-9 gzip over emitted bytes. It is
an artifact comparison measure, not a claim about a particular CDN transfer.

### Cold browser measurements

Each query receives its own cold series. A measured repetition creates a fresh
Chromium browser context with an empty HTTP cache, opens the benchmark page,
constructs a new `SearchClient`, waits for `ready()`, and runs that query once.
The browser process may be shared, but contexts, clients, and HTTP caches may
not. Each query has one discarded cold warm-up and ten measured fresh-context
runs. The report separates initialization duration, first-query duration, and
their combined duration for every query.

The loopback server exposes only the benchmark page, the built client module
files, and the generated index. Request observation counts only generated-index
paths and records unique request paths, request count, and response body bytes.
It also maps each fetched index path to the precomputed gzip-equivalent artifact
size. This keeps actual local bytes and deployable compressed-size estimates
distinct and excludes benchmark/client JavaScript from index-transfer metrics.

### Warm browser measurements

Warm measurement uses one initialized client and browser context. A discarded
pass exercises the entire fixed query set and populates the engine cache. Each
measured repetition then executes the query set in its declared order. The
report retains per-query samples and aggregates as well as whole-set latency.
No network requests are expected during engine-warm repetitions; an observed
index request fails the warm-mode contract instead of being ignored.

### Heap measurements

Chromium launches with precise-memory reporting enabled where supported. The
harness samples `performance.memory.usedJSHeapSize` after initialization, after
the first query, and after the warm query set. Heap values are directional and
browser-specific. If the API is unavailable or returns an invalid value, the
report records an explicit unavailable status and reason; it never substitutes
zero or a fabricated value.

## Report schema

The JSON report has an integer `schemaVersion` starting at `1` and these
top-level sections:

```text
schemaVersion
run
environment
corpus
index
queries
cold
warm
```

`run` contains UTC start time, commit, dirty-worktree status, profile, timing
method, warm-up count, repeat count, and completion duration. `environment`
contains operating system, architecture, CPU description, logical CPU count,
Node version, package-manager version, Playwright version, Chromium version,
headless mode, and relevant launch flags.

`cold` and `warm` retain raw samples plus calculated aggregates. Numeric fields
must be finite and non-negative. Counts and byte sizes must be non-negative
integers. Identifiers, hashes, versions, and paths must be non-blank. The report
validator rejects missing sections, an unknown schema version, incorrect sample
counts, percentile/sample disagreement, correctness failures, and warm network
activity.

Timestamp, commit, hardware, and latency fields make the reviewed report
environment-specific by design. Corpus, query, and configuration hashes make
the workload reproducible independently of those measurements.

## Data flow and cleanup

The full command performs these steps in order:

1. validate configuration and require a clean worktree for a reviewed run;
2. capture environment and commit metadata;
3. generate and hash the corpus;
4. build and write the real index into a unique temporary directory;
5. compute artifact measurements;
6. start a loopback-only server for the benchmark page, built client modules,
   and generated index;
7. launch Chromium and perform cold then warm measurements;
8. validate correctness and the complete report;
9. atomically write JSON through a temporary sibling and rename; and
10. print the summary.

Browser contexts, the browser, server, and temporary directory close in nested
`finally` paths. A failed run writes no final report. A failed atomic rename
removes its temporary sibling. The server binds only to loopback and rejects
path traversal and requests outside its explicit benchmark-page, client-module,
and generated-index roots.

## Error handling

The command fails with actionable context for:

- unsupported or malformed profile configuration;
- a dirty reviewed-run worktree;
- corpus or query identity mismatch;
- index build or write failure;
- server startup or browser launch failure;
- non-successful or unexpected HTTP requests;
- missing, non-finite, or negative measurements;
- incorrect query results;
- unexpected warm-mode network activity;
- report-schema or rendering failure; and
- output collision or atomic-write failure.

The smoke profile may run from a dirty worktree because it does not produce a
reviewable baseline artifact. Heap unavailability is the only tolerated missing
measurement and must remain explicit.

## Testing

Tests follow the narrowest useful boundary:

- configuration tests cover defaults, smoke overrides, and invalid values;
- corpus/query identity tests prove deterministic hashes and fixed correctness
  expectations;
- statistics tests cover odd/even samples, nearest-rank p50/p95, and invalid
  numbers;
- artifact tests cover recursive sizes and deterministic gzip equivalents;
- report tests cover schema validation, raw samples, aggregate consistency,
  heap availability, and serialization round trips;
- renderer tests snapshot the reviewed Markdown shape and verify source hash,
  environment, metrics, and interpretation warnings;
- server tests cover loopback serving, content types, 404s, and traversal
  rejection;
- cleanup tests force failures after server, browser, and temporary-file setup;
  and
- a Playwright smoke test exercises the generated index through the public
  `SearchClient`, verifies all query expectations, and confirms warm runs issue
  no index requests.

The repository's full lint, build, typecheck, Vitest, bundle-size, documentation,
and browser gates remain required before publication. The first reviewed CMS-2k
baseline is run manually on the maintainer environment and checked against the
report validator and renderer.

## Documentation and roadmap impact

Add `docs/project/performance-baseline.md` with:

- the exact command and reviewed report link;
- corpus, query, browser, hardware, and repetition metadata;
- index and browser results;
- cold/warm and byte-accounting definitions;
- heap limitations;
- reproduction steps; and
- an explicit statement that one machine and one profile do not establish
  supported operating ranges or budgets.

Update `docs/project/roadmap.md` to describe one published CMS-2k Chromium
vertical baseline while keeping multi-size, multi-browser, worker, mobile,
vector/hybrid, operating-range, threshold, and CI work open. Once implementation
and review are complete, move this design to
`docs/archive/specs/performance-baseline-harness.md` and archive the execution
plan alongside it.

## ADR impact

No ADR is required. The package is private measurement tooling and does not
change public APIs, index formats, ranking semantics, runtime architecture, or
deployment boundaries. Any later optimization justified by this evidence must
follow the normal ADR and compatibility rules when it changes shipped
architecture or behavior.

## Success criteria

The slice is complete when:

- the private package runs the real CMS-2k indexer and Chromium client path;
- the six-query set remains correctness-checked during measurement;
- cold and warm samples, transfers, heap status, artifact sizes, and environment
  metadata are present in schema-version-1 JSON;
- the report is validated and written atomically;
- the reviewed JSON deterministically renders the published Markdown baseline;
- focused, full repository, and browser checks pass;
- the full baseline is reproduced once on a clean maintainer checkout;
- no threshold or CI gate is introduced; and
- roadmap and archived records state the remaining evidence honestly.
