# Benchmarking Specification

Status: Draft — listed in [23-implementation-roadmap.md](23-implementation-roadmap.md)'s
Phase 3 and [24-architecture-recommendations.md](24-architecture-recommendations.md)'s
item 11 as the spec to write for this; both now point here rather than
restating its contents. This doc's own [Corpus Sizes](#corpus-sizes)
list below is likewise the one authoritative copy —
[22-project-governance.md](22-project-governance.md)'s Benchmark
Policy points here instead of keeping a separate copy.

## Purpose

Benchmarking defines how the project measures performance, detects regressions and validates architectural choices.

Performance is part of the product contract. Search must remain fast, memory-efficient and predictable in the browser.

## Goals

- Measure index build performance.
- Measure browser query performance.
- Track memory usage.
- Track download size.
- Compare JSON and binary formats.
- Detect regressions before release.
- Provide repeatable benchmark methodology.

## Non-goals

Benchmarking should not:

- replace correctness tests
- depend on external services
- require production data
- optimize for a single browser only
- hide variance by reporting only best-case numbers

## Benchmark Dimensions

Benchmarks should cover:

- corpus size
- document size
- vocabulary size
- number of fields
- number of facets
- shard count
- query complexity
- cold vs warm cache
- main thread vs worker execution
- JSON vs binary storage

## Corpus Sizes

Recommended standard corpus sizes:

- 100 documents
- 1,000 documents
- 2,000 documents
- 10,000 documents
- 50,000 documents
- 100,000 documents where feasible

The 2,000 document corpus is the reference target for small CMS deployments.

## Corpus Types

Maintain at least three corpus profiles.

### Documentation Corpus

Characteristics:

- medium-length pages
- title and body fields
- few facets
- high term overlap

### Product Corpus

Characteristics:

- short documents
- many facets
- high filter usage
- boosted fields

### Synthetic Stress Corpus

Characteristics:

- controlled vocabulary
- configurable document length
- configurable facet cardinality
- predictable query selectivity

Synthetic corpora are required for stable regression tests.

## Query Sets

Benchmark queries should include:

- single-term queries
- multi-term AND queries
- prefix queries
- no-match queries
- high-frequency terms
- low-frequency terms
- boosted queries
- filtered queries
- faceted queries
- pinned queries
- future fuzzy and synonym queries

Each query should declare expected selectivity:

- high
- medium
- low
- zero

## Measured Metrics

### Indexer Metrics

Track:

- build time
- documents per second
- output size
- manifest size
- term shard size
- doc store size
- facet shard size
- memory peak where measurable

### Runtime Metrics

Track:

- initialization time
- first query latency
- warm query latency
- p50 latency
- p95 latency
- p99 latency where meaningful
- worker startup time
- main-thread blocking time
- document loading time
- facet computation time
- scoring time

### Network Metrics

Track:

- bytes fetched for initialization
- bytes fetched for first query
- bytes fetched for warm query
- number of requests
- cache hit ratio

### Memory Metrics

Track:

- heap after initialization
- heap after first query
- heap after repeated queries
- retained shard cache size
- temporary allocation growth per query

Memory measurements are browser-dependent and should be treated as directional unless measured in controlled environments.

## Benchmark Modes

### Cold Mode

No warmed memory cache and no browser HTTP cache.

Measures first-user experience.

### Browser Cache Warm Mode

Browser HTTP cache is warm, in-memory search cache is cold.

Measures repeat visit behavior.

### Engine Warm Mode

Manifest and relevant shards are already loaded.

Measures interaction latency while typing.

## Measurement Rules

Rules:

- run each benchmark multiple times
- discard obvious setup outliers only with documented criteria
- report median and p95
- record browser, OS, CPU and Node versions
- record commit SHA
- record corpus version
- record configuration

Do not report only best-case results.

## Browser Coverage

Baseline browsers:

- Chromium
- Firefox
- WebKit where practical

CI may run Chromium only initially, but release validation should include broader browser coverage.

## Performance Budgets

Initial target budgets for the 2,000 document CMS corpus:

- first query under 100 ms after manifest load on modern desktop
- warm query under 50 ms on modern desktop
- initialization fetch under 100 KB compressed
- total query-triggered fetch under 2 MB compressed for common queries
- no long task over 50 ms when using worker execution

Budgets should be revised with real benchmark data.

## Regression Policy

A performance regression is any change that materially worsens:

- latency
- download size
- memory usage
- build time

Suggested thresholds:

- more than 10% latency regression
- more than 10% output size regression
- more than 10% memory regression
- more than 20% build-time regression

Regressions require one of:

- fix before merge
- documented justification
- explicit budget update

## Benchmark Output Format

Benchmark results should be emitted as machine-readable JSON.

Example fields:

```json
{
  "commit": "...",
  "corpus": "cms-2k",
  "browser": "chromium",
  "mode": "warm",
  "querySet": "default",
  "metrics": {
    "p50Ms": 18.4,
    "p95Ms": 41.2,
    "bytesFetched": 48231,
    "heapDeltaBytes": 524288
  }
}
```

Human-readable Markdown summaries may be generated from the JSON output.

## CI Integration

CI should eventually:

- run smoke benchmarks on every pull request
- run full benchmarks on main branch
- compare against previous baseline
- upload benchmark artifacts
- fail or warn on threshold breaches

Do not make early CI too slow. Start with smoke benchmarks.

## Correctness Coupling

Benchmark runs should verify that results remain correct.

At minimum:

- expected top result for selected queries
- expected hit count range
- deterministic ordering for fixed corpus

A benchmark that is fast but wrong is a failed benchmark.

## JSON vs Binary Evaluation

Binary format should only become default if benchmarks show meaningful improvement.

Compare:

- compressed download size
- parse/decode time
- memory usage
- query latency
- implementation complexity

Binary must preserve logical equivalence with JSON.

## Reporting

Benchmark reports should include:

- summary table
- regression table
- environment metadata
- corpus metadata
- notable outliers
- raw JSON artifact link

## Test Data Governance

Benchmark corpora should be versioned.

Synthetic generators should be deterministic and seeded.

Realistic corpora should avoid sensitive or proprietary content.

## Success Criteria

Benchmarking succeeds when:

- regressions are visible before release
- architectural trade-offs are data-driven
- JSON vs binary decisions are empirical
- memory growth is measurable
- performance budgets are explicit
- benchmark results are reproducible across commits
