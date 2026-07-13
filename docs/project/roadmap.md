# Roadmap

This page is the single current list of shipped capability and remaining work; detailed implementation history and superseded proposals are retained under `docs/archive/`.

## Status

| Area | Current state | Remaining work |
|---|---|---|
| Lexical search | Stable | Query-planner abstraction |
| Facets, synonyms, fuzzy search, and pins | Stable | No required 1.0 work |
| Internationalization | English and German profiles; fallback segmenters | Additional language profiles |
| Offline and worker execution | Stable | Resource-aware loading refinements |
| Binary storage | Term, fuzzy, and document-store codecs | Evaluate remaining shard formats from evidence |
| Vector and hybrid search | Storage, similarity, and local embeddings implemented | Public semantic showcase |
| Extensibility and diagnostics | Draft designs archived | Implement only with a concrete consumer |

## Near-term work

- Publish and maintain the audience-first documentation and searchable showcase.
- Add a semantic-search example that uses the existing vector/hybrid API and states its download and model costs clearly.
- Expand full language profiles only with representative corpora and cross-language conformance fixtures.
- Refine loading priority, memory controls, and prefetching from measured browser behavior rather than fixed speculative policies.
- Evaluate any further binary encoding only when lazy access and benchmarks show a meaningful gain over JSON.

## Consumer-driven architecture work

Query planning, a stable third-party plugin API, storage adapters, and deeper diagnostics have archived draft specifications. They are not part of the current public API. Reopen one only for a concrete consumer, update or replace the relevant draft, record an ADR where the architecture changes, and add conformance plus performance evidence.

## Explicit non-features

A query-time backend, browser-side index mutation, bundled analytics, mandatory WASM, and an application UI framework are outside the current product boundary. Access-controlled per-user search requires a different deployment architecture.

Historical completed phases are in [`archive/roadmaps/implementation-history.md`](../archive/roadmaps/implementation-history.md). Earlier architecture and release iterations remain in neighboring archived roadmap files.
