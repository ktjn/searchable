# Architecture Recommendations

This document captures architectural recommendations that are intentionally separate from the current implementation. These are not required for the initial release, but they will significantly improve extensibility, debuggability and long-term maintainability.

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

The search engine should not know whether data is JSON or binary.

Example:

TermStore
- get(term)
- prefix(prefix)

This allows JSON, binary and future memory-mapped formats without changing the search engine.

---

# 6. Define performance budgets

Establish explicit engineering targets.

Example:

- <20 MB downloaded
- <8 MB resident memory
- <50 ms query
- <5 MB heap growth per query

Performance discussions become objective once budgets exist.

---

# 7. Internal performance instrumentation

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

The current implementation materializes many intermediate arrays.

Future execution should move toward:

- PostingIterator
- IntersectionIterator
- UnionIterator
- ScoreIterator

This reduces allocations and scales much better.

---

# 9. Compression strategy

Document the intended evolution toward:

- delta encoded document ids
- variable length integers
- front-coded dictionaries
- block compression

The implementation can remain JSON initially.

---

# 10. Version compatibility

Define compatibility rules.

Rather than simply rejecting unknown versions, document which index versions each client supports.

---

# 11. Testing strategy

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

If the project grows into an ecosystem, define extension points intentionally.

Potential extension interfaces:

- registerAnalyzer()
- registerRanking()
- registerStorage()
- registerFacet()
- registerHighlighter()

---

# 14. Corpus validation

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