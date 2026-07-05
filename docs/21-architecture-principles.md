# Architecture Principles

This document defines the architectural principles that should guide every design decision in the project. These are long-term invariants rather than implementation details.

## Core Principles

### 1. Data-driven over code-driven

The search engine should derive its behavior from the index and configuration rather than hard-coded logic. New capabilities should preferably be enabled through data instead of code changes.

### 2. Separate planning from execution

Query parsing, planning and execution are distinct concerns.

- Analyzer converts text into terms.
- Planner builds an execution plan.
- Executor performs the work.

Each stage should evolve independently.

### 3. Storage independence

The execution engine must not depend on how index data is stored.

Supported storage implementations should include HTTP, IndexedDB, local files, Service Worker caches, Electron and Node without changing the execution engine.

### 4. Format independence

Search logic should not depend on JSON.

JSON, binary, memory-mapped or future formats should expose the same logical interfaces.

### 5. Shared analysis pipeline

Index-time and query-time analysis must always use exactly the same implementation.

Tokenization, normalization and stemming must never diverge.

### 6. Deterministic behavior

The same input corpus and configuration should always produce:

- identical index artifacts
- identical ranking
- identical query results

Deterministic builds simplify debugging, testing and caching.

### 7. Lazy resource loading

Load only the resources required to answer the current query.

Avoid eager downloading unless explicitly requested for prefetching.

### 8. Graceful degradation

Optional features should degrade gracefully.

Examples:

- No Web Worker → execute on the main thread.
- Missing optional shards → continue where possible.
- Older index format → fail with a clear compatibility error.

### 9. Small public API

Keep the public API intentionally small.

Expose extension points instead of exposing internal implementation details.

### 10. Performance as a feature

Performance is a functional requirement.

Every change should be evaluated against measurable budgets for latency, memory and download size.

### 11. Observability by design

Every query should be explainable.

Provide sufficient diagnostics to understand:

- planning
- execution
- ranking
- timing
- cache usage

### 12. Extensibility over specialization

Design stable abstractions so future capabilities such as fuzzy search, synonyms, vector search or custom ranking can be added without rewriting the engine.

### 13. Zero runtime dependencies

Prefer browser platform APIs over external libraries.

Dependencies should only be introduced when they provide substantial long-term value.

### 14. Browser-first

The browser runtime is the primary execution environment.

Server-side tooling exists to build the index, not to execute queries.

### 15. Backward compatibility

Index formats should evolve in a controlled manner.

Breaking changes should be deliberate, documented and versioned.

## Decision Checklist

Before introducing a new feature, ask:

- Does it preserve the separation between planning and execution?
- Does it introduce unnecessary coupling?
- Can it be implemented as an extension?
- Does it preserve deterministic behavior?
- Does it increase download size or memory usage?
- Is it observable and explainable?
- Does it keep the browser runtime simple?

If the answer to several of these questions is 'no', reconsider the design.

## Long-term Vision

The project should evolve into a general-purpose client-side search platform rather than a collection of search features. New capabilities should emerge by composing stable abstractions rather than expanding monolithic implementations.