# Architecture Recommendations

This document captures architectural recommendations that are intentionally separate from the current implementation. These are not required for the initial release, but they will significantly improve extensibility, debuggability and long-term maintainability.

## Status

Most of these recommendations now have a written spec (marked ✅ below,
with a link) — the recommendation text is kept for its rationale, but
the spec is the current source of truth for design details. Items
without one yet are tracked centrally in
[23-implementation-roadmap.md](23-implementation-roadmap.md#still-open)
rather than duplicated here.

## Priority

High:

- Query planner
- Storage abstraction
- Explain API
- Performance and memory budgets
- Benchmark suite

Medium:

- Pipeline plugins
- Binary storage abstraction
- Iterator-based execution
- Version compatibility strategy
- Corpus validation

Low:

- Compression formats
- Advanced plugin ecosystem

---

# 1. Introduce a query planner

**Status:** ✅ specified — see [spec-query-planner.md](spec-query-planner.md).

Separate planning from execution.

Query
→ Analyzer
→ Planner
→ Execution Plan
→ Executor

Benefits:

- optimization
- explain support
- synonyms
- fuzzy search
- query rewriting
- vector search
- multiple executors

Search execution should consume an execution plan instead of interpreting the raw query.

---

# 2. Add an Explain API

**Status:** ✅ specified — see [spec-diagnostics.md](spec-diagnostics.md).

Recommendation:

client.explain(query, documentId)

The API should explain:

- matching fields
- BM25 contributions
- boosts
- filters
- pinning
- final score

This becomes invaluable when debugging ranking.

---

# 3. Make the pipeline pluggable

**Status:** ✅ specified — see [spec-plugin-api.md](spec-plugin-api.md)'s
six-stage hook pipeline and [17-plugin-architecture.md](17-plugin-architecture.md).

Instead of only making tokenization configurable, define a full search pipeline.

Analyzer
→ Query rewrite
→ Synonyms
→ Spell correction
→ Expansion
→ Execution
→ Post-processing

Each stage should have a replaceable interface.

---

# 4. Introduce a storage abstraction

**Status:** ✅ specified — see [spec-storage-api.md](spec-storage-api.md).

Search execution should not know where index data comes from.

Example interface:

- fetchManifest()
- fetchTermShard()
- fetchFacetShard()
- fetchDocShard()

Possible implementations:

- HTTP
- IndexedDB
- File System API
- Electron
- Node
- Service Worker cache

---

# 5. Introduce a binary abstraction

**Status:** ✅ specified — see [spec-binary-format.md](spec-binary-format.md);
partially built, see [09-roadmap.md](09-roadmap.md) Phase 7.

The search engine should not know whether data is JSON or binary.

Example:

TermStore
- get(term)
- prefix(prefix)

This allows JSON, binary and future memory-mapped formats without changing the search engine.

---

# 6. Define performance budgets

**Status:** ✅ specified — see [spec-benchmarking.md](spec-benchmarking.md)'s
Performance Budgets section. The *allocation-strategy* half of this
(cache ownership, object lifetime) is still open — tracked as "Memory
Model" in [23-implementation-roadmap.md](23-implementation-roadmap.md#still-open).

Establish explicit engineering targets.

Example:

- <20 MB downloaded
- <8 MB resident memory
- <50 ms query
- <5 MB heap growth per query

Performance discussions become objective once budgets exist.

---

# 7. Internal performance instrumentation

**Status:** ✅ specified — see [spec-diagnostics.md](spec-diagnostics.md)'s
phase-timing / query-trace design.

Measure every major phase:

- analysis
- shard loading
- intersection
- scoring
- document loading
- facet computation

This information does not need to be public but should be available for diagnostics.

---

# 8. Iterator-based execution

**Status:** still open — no spec yet, tracked in
[23-implementation-roadmap.md](23-implementation-roadmap.md#still-open).

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
scoring shows up as a hot path in the benchmark suite (item 12 below),
independent of whether the broader iterator-based execution model
ever lands.

This reduces allocations and scales much better.

---

# 9. Compression strategy

**Status:** ✅ specified — see [spec-binary-format.md](spec-binary-format.md)'s
Compression section.

Document the intended evolution toward:

- delta encoded document ids
- variable length integers
- front-coded dictionaries
- block compression

The implementation can remain JSON initially.

---

# 10. Version compatibility

**Status:** policy exists
([22-project-governance.md](22-project-governance.md#compatibility-policy)),
but the concrete matrix this recommends is still open — same gap as
"Compatibility Matrix" in
[23-implementation-roadmap.md](23-implementation-roadmap.md#still-open).

Define compatibility rules.

Rather than simply rejecting unknown versions, document which index versions each client supports.

---

# 11. Testing strategy

**Status:** mostly specified — see
[10-testing-and-performance.md](10-testing-and-performance.md) (unit,
integration/e2e, golden-file/regression, performance-regression layers
are covered there; property and fuzz testing are not yet adopted).

Document expected testing layers:

- unit tests
- integration tests
- browser tests
- golden ranking tests
- compatibility tests
- property tests
- fuzz tests
- performance regression tests

---

# 12. Benchmark suite

**Status:** ✅ specified — see [spec-benchmarking.md](spec-benchmarking.md).

Maintain benchmark datasets for multiple corpus sizes.

Suggested sizes:

- 100
- 1,000
- 2,000
- 10,000
- 50,000 documents

Track:

- build time
- download size
- first query
- warm query
- throughput
- memory

---

# 13. Stable extension API

**Status:** ✅ specified — see [spec-plugin-api.md](spec-plugin-api.md)
and [17-plugin-architecture.md](17-plugin-architecture.md).

If the project grows into an ecosystem, define extension points intentionally.

Potential extension interfaces:

- registerAnalyzer()
- registerRanking()
- registerStorage()
- registerFacet()
- registerHighlighter()

---

# 14. Corpus validation

**Status:** still open — no spec yet, tracked in
[23-implementation-roadmap.md](23-implementation-roadmap.md#still-open).

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

Think of this as an 'ESLint for search content'.

---

# Summary

The current architecture provides a solid foundation. The recommendations in this document focus on long-term extensibility and operational maturity rather than adding new search features. They should be treated as architectural guidance for future iterations rather than immediate implementation work.