# Implementation Roadmap

**Relationship to [09-roadmap.md](09-roadmap.md)**: the "Phase 1-4" below
is a *specification-writing* sequence (which design docs to write next),
a different axis from 09-roadmap.md's "Phase 0-8", which tracks actual
*build* status (what has working code vs. what's design-only) and is
the canonical source for "is X done." A doc phase and a build phase
with the same number here are coincidental, not the same milestone —
e.g. this doc's "Phase 1" (binary format / query planner / storage
specs) has no fixed correspondence to 09-roadmap.md's Phase 1 (the
minimal viable engine, long since built).

This document identifies the remaining major technical specifications that should be written before the project reaches a stable 1.0 architecture.

## Objective

Keep implementation aligned with well-defined specifications rather than allowing architecture to emerge from incremental feature work.

## Status

Six of this doc's original eight items now have a written spec (linked
below). Three genuinely remain unwritten — see "Still open" at the
bottom, which is now the single tracking list for them (folded in from
[24-architecture-recommendations.md](24-architecture-recommendations.md)'s
overlapping items #8, #10, and #14 rather than tracking the same gaps
twice).

## Phase 1 – Core Specifications

### Binary Index Format — ✅ written

See [spec-binary-format.md](spec-binary-format.md) (layout, versioning,
endianness, compression, random access, compatibility). Partially
built — see [09-roadmap.md](09-roadmap.md) Phase 7.

### Query Planner — ✅ written

See [spec-query-planner.md](spec-query-planner.md) (logical query tree,
execution plan, optimization passes, cost model, execution interfaces).
Drafted extensibility groundwork, not yet built.

### Storage Layer — ✅ written

See [spec-storage-api.md](spec-storage-api.md) (storage interfaces,
cache responsibilities, offline support, transport independence).
Drafted extensibility groundwork, not yet built.

## Phase 2 – Extensibility

### Plugin API — ✅ written

See [spec-plugin-api.md](spec-plugin-api.md) (extension points for
analyzers, ranking, storage, highlighting, facets, query rewriting;
lifecycle, registration, compatibility rules).

### Ranking Framework — still open

How multiple ranking strategies coexist while preserving deterministic
ordering has no dedicated spec yet.

## Phase 3 – Performance

### Benchmark Methodology — ✅ written

See [spec-benchmarking.md](spec-benchmarking.md) (datasets, hardware
assumptions, browser versions, warm vs. cold measurements, reporting
format, performance budgets).

### Memory Model — still open

Expected allocation strategy, cache ownership, and object lifetime have
no dedicated spec yet — distinct from spec-benchmarking.md's budget
*numbers*, this would document the allocation *strategy* behind them.

## Phase 4 – Operational Features

### Diagnostics — ✅ written

See [spec-diagnostics.md](spec-diagnostics.md) (explain API, query
trace/phase timings, metrics, profiling hooks).

### Compatibility Matrix — still open

No maintained table of client/index/plugin version compatibility exists
yet. [22-project-governance.md](22-project-governance.md#compatibility-policy)
sets the *policy* (older clients fail with a clear error, breaking
changes are versioned); this item is the concrete matrix that policy
implies.

## Still open

The three items above, plus two related recommendations from
[24-architecture-recommendations.md](24-architecture-recommendations.md)
that turned out to be the same kind of unwritten spec rather than
separate work:

- **Ranking Framework** (this doc).
- **Memory Model** (this doc).
- **Compatibility Matrix** (this doc; same gap as 24's recommendation #10,
  "Version compatibility").
- **Iterator-based execution** (24's recommendation #8) — moving scoring
  off materialized intermediate arrays onto `PostingIterator` /
  `IntersectionIterator` / `UnionIterator` / `ScoreIterator`.
- **Corpus validation / content linter** (24's recommendation #14) — the
  indexer catching duplicate URLs/titles, empty bodies, invalid facets,
  conflicting pins, invalid canonical URLs, language mismatches.

## Success Criteria

The implementation should always follow an approved specification. Significant architectural work should begin with documentation and design before code changes are introduced.