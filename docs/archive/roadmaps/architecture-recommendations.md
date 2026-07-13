# Architecture Recommendations

This document captures architectural recommendations that are intentionally separate from the current implementation. These are not required for the initial release, but they will significantly improve extensibility, debuggability and long-term maintainability.

**Status note**: several items below have since gained a draft spec or a decision record — each such item is now a one-line pointer rather than a restatement, to avoid this doc and those documents quietly drifting apart. Only items with no spec yet keep their full description here. See [23-implementation-roadmap.md](23-implementation-roadmap.md) for which specs remain to be written and in what order — that's the reconciled version of this doc's old, separately-maintained priority list.

## Priority

High:

- Performance and memory budgets (item 6 — no spec yet)
- Ranking framework ([23](23-implementation-roadmap.md) — no spec yet)

Medium:

- Iterator-based execution (item 8 — no spec yet)
- Corpus validation / content linter (item 13 — no spec yet)

Low:

- Everything else below already has a draft spec or decision record — see each item's pointer.

---

# 1. Query planner

Specified in [spec-query-planner.md](spec-query-planner.md) (draft, not yet implemented) and decided at the architecture level in [ADR-0001](adr/0001-pull-based-static-http.md)'s transport model.

---

# 2. Explain API / internal performance instrumentation

Specified in [spec-diagnostics.md](spec-diagnostics.md) (draft, not yet implemented) — covers both the explain API and phase-timing instrumentation in one document rather than as two separate recommendations.

---

# 3. Make the pipeline pluggable

The plugin contract is decided in [17-plugin-architecture.md](17-plugin-architecture.md) (a fixed six-stage hook pipeline) and explored from a different angle in [spec-plugin-api.md](spec-plugin-api.md) — see that spec's own header for how the two relate. [ADR-0005](adr/0005-plugin-opt-in-boundary.md) records the core-vs-opt-in boundary decision already shipped. Not yet built: the dynamic registration mechanism itself.

---

# 4. Storage abstraction

Specified in [spec-storage-api.md](spec-storage-api.md) (draft, not yet implemented).

---

# 5. Binary/storage-format abstraction

Specified in [spec-binary-format.md](spec-binary-format.md) (draft spec; term/fuzzy/doc-store shards are already implemented and shipped, per that doc's own status note) and decided in [ADR-0002](adr/0002-json-first-index-format.md).

---

# 6. Define performance budgets

Establish explicit engineering targets.

Example:

- <20 MB downloaded
- <8 MB resident memory
- <50 ms query
- <5 MB heap growth per query

Performance discussions become objective once budgets exist. No spec or decision record covers this yet — the closest existing artifact is the bundle-size *code* budget (15 KB gzip, enforced in CI, [08-modern-features.md](08-modern-features.md#bundle-size-budget)), which is a narrower, already-shipped instance of the same idea for one specific resource.

---

# 7. Compression strategy

Specified in [spec-binary-format.md](spec-binary-format.md), which already covers delta-encoded ids and varints for the shipped binary tier; front-coded dictionaries and block compression remain future work within that same spec.

---

# 8. Iterator-based execution

The current implementation materializes many intermediate arrays.

Future execution should move toward:

- PostingIterator
- IntersectionIterator
- UnionIterator
- ScoreIterator

A related, smaller-scoped optimization independent of the iterator
rewrite: today's scoring path sorts the full scored-hit set to apply
`limit`. A top-K heap (bounded-size min-heap, pop-and-replace when a
new hit outscores the current minimum) avoids the full sort and caps
memory to `limit` regardless of corpus size — worth doing whenever
scoring shows up as a hot path in the benchmark suite
([spec-benchmarking.md](spec-benchmarking.md)), independent of whether
the broader iterator-based execution model ever lands.

This reduces allocations and scales much better. No spec yet — this is
the one performance-architecture item without one.

---

# 9. Version compatibility

**Done**: [docs/02-index-format.md](02-index-format.md#versioning--cache-strategy)
documents the client/index-version support matrix, `validateManifest()`
enforces it at load time (rejects an unrecognized `Manifest.version`
with a clear error), and [ADR-0004](adr/0004-compatibility-policy.md)
records the decision to keep API semver and index-format versioning as
two independent numbers. Nothing left to design here.

---

# 10. Testing strategy

Covered by [10-testing-and-performance.md](10-testing-and-performance.md),
which documents the actual layered suite (correctness tests, the
performance/benchmark suite, and "done" criteria per feature) and is
kept current as build status changes — that doc is authoritative, not
this bullet.

---

# 11. Benchmark suite

Specified in [spec-benchmarking.md](spec-benchmarking.md) (draft
methodology; corpus sizes, hardware assumptions, warm/cold measurement,
reporting format) — that spec's own Corpus Sizes list is the
authoritative one; [22-project-governance.md](22-project-governance.md)'s
Benchmark Policy points here rather than repeating its own copy of the
list.

---

# 12. Stable extension API

Covered by [17-plugin-architecture.md](17-plugin-architecture.md) (the
decided registration/capability-negotiation contract) and
[spec-plugin-api.md](spec-plugin-api.md) (a draft exploring the same
goal from a typed-interface angle — see that spec's header for how the
two relate).

---

# 13. Corpus validation

The indexer should evolve into a content linter.

Examples:

- duplicate URLs
- duplicate titles
- missing titles
- empty bodies
- invalid facets
- conflicting pins
- invalid canonical URLs
- language mismatches

Think of this as an 'ESLint for search content'. No spec yet.

---

# Summary

The current architecture provides a solid foundation. Most of the
recommendations this document originally proposed now have a draft
spec or a decided ADR — see each item's pointer above rather than this
doc's old, separately-restated version. What's left without a spec
(performance budgets, iterator-based execution, corpus validation, the
ranking framework in [23-implementation-roadmap.md](23-implementation-roadmap.md))
is real remaining architectural guidance for future iterations, not
immediate implementation work.
