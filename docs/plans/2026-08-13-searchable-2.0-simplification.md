# Searchable 2.0 Simplification Plan

## Status

Active

## Summary

Searchable 2.0 is a simplification release, not a feature release.

The target architecture is deliberately small:

```text
content
  -> Python indexer
  -> immutable JSON index
  -> static hosting
  -> TypeScript browser client or Python client
  -> BM25F lexical results
```

2.0 removes architectural dimensions that are not essential to that model:

- Web Worker execution
- Service Worker support
- general binary index formats
- vector and hybrid search
- embedding/model integrations
- unnecessary npm/Python package boundaries
- legacy compatibility paths that can be replaced by rebuilding generated indexes
- speculative planner/plugin/storage abstractions

The target product has one Python distribution, one JavaScript package, one JSON index contract, two supported query runtimes, and one lexical retrieval model.

## Goals

- Preserve static, serverless query-time deployment.
- Preserve the Python search client.
- Preserve the TypeScript browser client.
- Preserve BM25F lexical search quality.
- Preserve deterministic, content-addressed indexes.
- Preserve facets, fuzzy search, synonyms, pins, phrases, prefixes, highlighting, language analysis, and section-level indexing.
- Publish one Python distribution: `searchable`.
- Publish one JavaScript package: `@ktjn/searchable`.
- Make JSON the only general index representation.
- Make direct main-thread execution the only browser execution model.
- Make Python/TypeScript observable conformance a first-class quality gate.
- Move stable search policy to build configuration/manifest rather than per-query switches.
- Remove 1.x compatibility machinery where rebuilding indexes is a simpler migration.

## Non-Goals

- Adding new search features.
- Preserving every 1.x API/index format.
- Preserving vector/hybrid compatibility.
- Preserving binary compatibility.
- Preserving Worker protocol compatibility.
- Providing application-level offline support.
- Introducing WASM to share query implementation code.
- Introducing a query planner or plugin API.
- Replacing BM25F.

## Architecture Principles

1. Static search is the product.
2. BM25F lexical search is the built-in retrieval model.
3. JSON is the interoperability contract.
4. Python and TypeScript are two intentional implementations of one observable search contract.
5. Main-thread browser execution is the default and only 2.0 execution path.
6. HTTP/browser caching is sufficient infrastructure; application Service Workers stay outside Searchable.
7. Internal modules do not become public packages without an independent consumer.
8. Stable engine policy belongs at build/client configuration time; query options describe a query.
9. Major versions may delete complexity instead of carrying adapters forever.
10. Workers, binary formats, planners, WASM, ANN, and similar machinery require measured need before reintroduction.

## Target Public Surface

### TypeScript

```bash
pnpm add @ktjn/searchable
```

```ts
import { SearchClient } from "@ktjn/searchable";

const search = new SearchClient("/search/manifest.json");
const result = await search.search("getting started");
```

Do not expose `worker`, `workerUrl`, Worker protocol concepts, vector providers, embedding callbacks, or Service Worker integration.

### Python

```bash
uv add searchable
```

```python
from searchable import SearchClient

search = SearchClient("./search/manifest.json")
result = search.search("getting started")
```

CLI target:

```bash
searchable build ./site --output ./site/search
searchable inspect ./site/search
searchable search ./site/search "getting started"
```

Exact command names can be finalized during consolidation, but there should be one Python distribution and one executable namespace.

## Target Repository Shape

```text
packages/
  searchable/
    src/
      client.ts
      search/
      analysis/
      index/
      format/

python/
  searchable/
    src/searchable/
      cli.py
      client/
      indexer/
      analysis/
      format/

tools/
  relevance/

showcase/
docs/
```

Fixtures and relevance tooling are repository tooling, not separately published product packages.

## Query Configuration Boundary

Stable policy should be recorded in build configuration/manifest where possible:

- field definitions and boosts
- analyzers/languages
- fuzzy defaults
- synonyms
- pins
- facet definitions
- stored fields
- shard sizing

Query-time options should be limited to values that genuinely vary between calls, approximately:

```ts
interface SearchOptions {
  limit?: number;
  language?: string;
  filters?: Filters;
  facets?: string[];
  signal?: AbortSignal;
}
```

Review `highlight` separately. Explicitly review and remove or relocate `fuzzy`, `fuzzyWeight`, `synonyms`, `synonymWeight`, query-time boosts, and retrieval-mode options.

Do not change ranking behavior accidentally while moving configuration. Golden and relevance tests define expected behavior.

## Removed Capabilities

### Web Worker

Delete Worker runtime, entry point, protocol, versioning, serialization, error reconstruction, lifecycle management, Worker-specific cancellation logic, `worker`, `workerUrl`, Worker build artifacts, tests, and docs.

Search remains asynchronous because shard loading is asynchronous.

Reintroducing off-main-thread execution requires representative browser evidence showing material main-thread/INP impact that simpler optimization cannot solve.

### Service Worker

Delete Searchable-owned offline/cache runtime and public integration surface.

Generated assets are immutable and content-addressed. Document recommended cache headers. A consuming PWA may cache Searchable files in its own Service Worker.

### Binary Formats

Delete custom binary term, fuzzy, document-store, and related general-purpose encoders/decoders and manifest variants. JSON becomes canonical and exclusive for general index structures.

Record current binary-vs-JSON benchmark evidence before deletion for historical reference, but do not keep the architecture merely because binary may reduce raw bytes.

### Vector/Hybrid Search

Delete vector indexing, shards, vector query execution, hybrid fusion, embedding configuration/callbacks, Transformers/model integrations, vector-specific errors/options/tests/examples/benchmarks/docs.

Searchable's RAG role becomes lexical candidate retrieval:

```text
question
  -> optional query rewrite in the RAG application
  -> Searchable lexical retrieval
  -> top documents/sections
  -> LLM context
```

If a future application needs semantic retrieval, implement it outside Searchable first and reconsider the core boundary only with evidence.

## Retained Capabilities

Retain:

- BM25F
- field/document boosts where part of the index contract
- prefix queries
- quoted phrases
- fuzzy matching
- synonyms
- terms/range/hierarchical facets
- contextual facet counts
- pins
- highlighting
- did-you-mean where based on lexical/fuzzy data
- supported language profiles and fallback segmenters
- section-level HTML indexing
- deterministic builds
- immutable content-addressed shards
- lazy browser shard fetching
- Python search over local/HTTP indexes as required by current consumers
- relevance evaluation

Both clients need conformance coverage for every retained capability exposed by both runtimes.

## Compatibility Policy

2.0 should introduce a clean JSON-only lexical manifest format version.

Generated 1.x indexes are not migration assets. Consumers rebuild from source/configuration using the 2.0 indexer.

Clients should reject unsupported 1.x manifests with a clear rebuild/migration error rather than carrying broad compatibility branches.

Package APIs continue to use semver independently from the manifest's integer format version.

## Cross-Runtime Conformance

Build golden indexes once with the Python indexer and run identical query fixtures through Python and TypeScript clients.

Cover terms and multi-term queries, AND/OR semantics if retained, phrases, prefixes, fuzzy expansion, synonyms, scoring/boosts, languages, filters, facets/contextual counts, pins, highlighting where both runtimes expose it, did-you-mean, limits/pagination where applicable, zero results, and malformed/unsupported manifests.

Compare ordered IDs/URLs, total hits, scores within documented tolerance, facets, pins, resolved language, and suggestions.

Do not require implementation identity; require contract equivalence.

## RAG Migration

Before deleting vector search, create a representative RAG retrieval evaluation set with real or representative questions and expected source sections/documents.

Measure lexical retrieval using source/citation recall at k and answer-grounding checks where available.

Prefer these improvements over restoring vectors:

- index sections, not only pages
- preserve strong headings/titles
- field boosts
- domain synonyms
- RAG-side query rewriting/keyword extraction
- slightly larger lexical candidate sets where context budget permits

The goal is acceptable real RAG behavior, not ranking equivalence with the old vector path.

## Consumer Inventory

Before breaking compatibility, record every known active consumer and packages imported, runtime, indexer invocation, Worker usage, Service Worker usage, binary configuration, vector/hybrid usage, query option usage, direct `analysis`/`format` imports, and RAG usage.

Include current static docs/search consumers, Python search consumers, RAG integration, Modelable/static Playground, showcase, and repository-hosted integrations found during implementation.

# Implementation Slices

Each slice must leave the repository buildable and tested. Prefer deletion-first PRs with one architectural dimension each.

## Slice 0 — Freeze 1.x Feature Expansion

**Work**

- Make this plan the active 2.0 architecture direction.
- Update roadmap items that still plan Worker refinement, binary expansion, or vector work.
- Mark structured-binary plans as superseded.
- Permit correctness/relevance fixes, but require feature proposals to justify 2.0 necessity.

**Exit:** no active roadmap target requires adding Worker, Service Worker, binary, or vector architecture.

## Slice 1 — Baseline and Contract Inventory

**Work**

- Inventory public TS/Python exports and manifest fields.
- Classify each as keep/remove/move-internal.
- Inventory consumers.
- Normalize cross-runtime lexical golden fixtures.
- Record current relevance results.
- Record representative main-thread browser performance.
- Record existing binary-vs-JSON evidence.
- Create RAG lexical evaluation fixtures.

**Exit:** retained observable behavior, removed API/manifest fields, consumers, and migration risks are explicitly known.

## Slice 2 — Remove Vector and Hybrid Search

**TypeScript:** delete vector search, hybrid fusion, embedding integration, vector exports/options/errors.

**Python:** delete vector/hybrid execution, embedding callback/config, vector readers.

**Indexer:** stop generating vectors and remove vector manifest fields/configuration.

**Repository:** remove vector dependencies/tests/docs/showcase/benchmarks and migrate the RAG consumer to lexical retrieval.

**Exit:** no public/index concept remains for vector, hybrid, embedding, model runtime, or retrieval mode; RAG lexical evaluation is acceptable.

## Slice 3 — Remove Web Worker Runtime

**Work**

- Keep direct TypeScript search only.
- Delete Worker source, protocol, versions, DTOs, error serialization, lifecycle code, Worker-specific cancellation, build outputs, tests, and docs.
- Remove `worker` and `workerUrl`.
- Simplify `SearchClient` orchestration.

**Tests:** browser features on main thread, abort/instant-search cancellation, representative Chromium performance.

**Exit:** exactly one TypeScript execution path.

## Slice 4 — Remove Service Worker Support

**Work**

- Delete Searchable Service Worker runtime/exports/config/tests.
- Remove owned offline showcase behavior.
- Document HTTP cache headers and app-owned PWA caching.

**Exit:** Searchable owns no Service Worker/cache lifecycle.

## Slice 5 — Define JSON-Only 2.0 Index

**Work**

- Define new manifest format version.
- Remove vector fields and binary selectors/metadata.
- Keep only JSON shard references.
- Keep deterministic serialization and content-addressed names.
- Emit every retained shard family as JSON.
- Update schema/fixtures/docs.

**Tests:** deterministic rebuild, validation, both clients reading all retained shard families, representative consumers rebuilding from source.

**Exit:** Python indexer emits a complete searchable JSON-only v2 index.

## Slice 6 — Delete Binary and Legacy Storage Paths

**TypeScript:** delete binary directory, term, fuzzy, and document-store readers; simplify shard loading to JSON.

**Python:** delete binary codecs/readers and binary package boundary.

**Indexer:** delete binary writers/configuration.

**Compatibility:** reject old binary manifests with a clear rebuild error; no query-time conversion.

**Exit:** JSON is the only active index representation and binary code is gone, not dormant.

## Slice 7 — Consolidate TypeScript Packages

**Work**

- Produce final `@ktjn/searchable` package.
- Move client, analysis, format/schema code into internal modules.
- Move fixtures/relevance to repository tooling.
- Remove internal package publication/version wiring.
- Audit and minimize root exports.
- Update all consumers/imports.

Likely public exports are `SearchClient`, result/hit types, query/filter/facet types, and intentional handleable errors. Do not export shard readers, scoring internals, manifest codecs, analyzer internals, or protocol types without a real external API need.

**Exit:** one publishable npm product package.

## Slice 8 — Consolidate Python Packages

**Work**

- Produce final `searchable` distribution.
- Move indexer, Python client, analysis and format helpers under it.
- Remove separate `searchable-indexer`, `searchable-analysis`, `searchable-binary`, and `searchable-client` distributions.
- Provide one CLI namespace.
- Update consumers/docs/imports.

**Tests:** clean `uv` build/install, CLI smoke tests, Python client conformance, package export tests.

**Exit:** `uv add searchable` installs all supported Python functionality.

## Slice 9 — Simplify Public Client/Query APIs

For every option ask whether a caller changes it between queries, whether it is query state or engine policy, whether it complicates conformance, whether it can be configured once, and whether a current consumer needs it.

**Work**

- Reduce TS constructor to index location plus genuinely stable client configuration.
- Keep Python conceptually equivalent without forcing identical syntax.
- Move engine policy to manifest/build config.
- Review fuzzy/synonym/boost/highlight options.
- Keep `AbortSignal` in TypeScript where needed for instant search.
- Remove compatibility/snapshot machinery that only served deleted execution/event surfaces.

**Exit:** basic TS API is effectively `new SearchClient(indexUrl)` then `search(query, options?)`; query options are substantially smaller and query-specific.

## Slice 10 — Simplify Internal Search/Loading Code

Review `client.ts`, core `search.ts`, shard cache/fetch, URL handling, validation, query parsing, scoring, facets, fuzzy, synonyms, highlighting, and document loading.

Delete binary-vs-JSON branches, lexical-vs-vector/hybrid branches, Worker-vs-direct branches, old compatibility adapters, duplicate transport DTOs, interfaces/factories with one implementation, and abstractions whose variability no longer exists.

Do not introduce a query planner during cleanup.

**Exit:** core search flow can be followed directly from query parse -> shard load -> score/filter -> result.

## Slice 11 — Delete 1.x Compatibility and Dead Dependencies

**Work**

- Remove obsolete manifest compatibility where rebuild is the migration.
- Remove deprecated aliases.
- Remove dead Worker/binary/vector fields and feature flags.
- Remove unused dependencies and optional dependencies.
- Remove stale scripts/tests whose only purpose is deliberately unsupported 1.x behavior.

**Exit:** repository searches for removed concepts find only intentional migration/history/archive references.

## Slice 12 — Documentation and Showcase Reset

Focus current docs on installation, first search, indexing, ranking, facets/filters, fuzzy/synonyms, languages, section indexing, RAG lexical retrieval, deployment/caching, TS API, Python API, CLI, index format, configuration, migration, architecture, ADRs, and roadmap.

**Work**

- Rewrite architecture around Python indexer + JSON + two clients.
- Remove current Worker/Service Worker/binary/vector docs.
- Archive only historically useful material.
- Put the minimal happy path first in README.
- Keep showcase lexical-only.
- Add 1.x -> 2.0 migration guide.

**Exit:** a new user encounters no removed concept while following install -> build -> host -> search.

## Slice 13 — Consumer Migration

Migrate active consumers individually: static docs/search consumers, Python search consumers, RAG pipeline, Modelable/static Playground or other structured-binary consumers, and showcase/docs.

For each: rebuild indexes, update package/import names, remove Worker and binary configuration, replace vector/hybrid with lexical retrieval, move offline/cache policy to app level if needed, run tests, and record whether friction represents a missing core capability or only migration work.

Do not restore removed architecture to avoid minor consumer changes.

**Exit:** every known active consumer is migrated or has an explicitly accepted blocker.

## Slice 14 — Performance and Relevance Gate

Measure cold/warm p50/p95, main-thread CPU, long tasks, compressed transferred bytes, parsed JSON bytes, memory where reliable, and prefix/fuzzy/facet-heavy queries using the established CMS-scale corpus and a larger representative corpus if available.

Run existing judged lexical suites and RAG retrieval evaluation. Packaging/storage/execution changes should not silently alter lexical ranking.

**Exit:** no unexplained relevance regression; main-thread execution is acceptable for documented ranges; RAG lexical retrieval is acceptable; scale limits are documented.

## Slice 15 — Release Hardening

**Work**

- Finalize package names/versions and index format version.
- Validate clean npm/Python publishing and package contents.
- Validate migration guide.
- Update changelog with breaking removals.
- Run full CI and consumer smoke tests.
- Release 2.0.

Required gates include build, unit/browser tests, typecheck, lint, consolidated Python `uv` checks, deterministic index builds, cross-runtime conformance, relevance, RAG retrieval evaluation, browser performance, package checks, and docs/showcase build.

**Exit:** one npm product package, one Python distribution, one JSON-only lexical contract, two conforming runtimes, no Worker, no Searchable Service Worker, no general binary codecs, no vector/hybrid search, known consumers migrated, current docs describing only 2.0.

## Dependency Order

```text
0 Freeze
  |
1 Baseline/contract
  |
  +---- 2 Remove vector/hybrid
  |
  +---- 3 Remove Worker
  |
4 Remove Service Worker
  |
5 JSON-only v2 format
  |
6 Delete binary
  |
  +---- 7 TS package consolidation
  |
  +---- 8 Python package consolidation
  |
9 Public API simplification
  |
10 Internal simplification
  |
11 Compatibility/dependency deletion
  |
12 Docs/showcase reset
  |
13 Consumer migration
  |
14 Performance/relevance gate
  |
15 Release
```

Package consolidation intentionally follows major feature/storage deletion so code is moved once.

## PR Slicing Rules

Good PRs remove or consolidate one dimension: RAG lexical migration, vector removal, Worker removal, JSON-only manifest, binary deletion, TS package consolidation, Python package consolidation, or query API simplification.

Avoid one PR that simultaneously renames packages, changes ranking, changes manifest, removes binary, and rewrites the client.

Each 2.0 PR should state the plan slice, public behavior change, concepts/code deleted, checks run, and any remaining temporary compatibility code with justification.

## Migration Model

Generated 1.x indexes are rebuilt, not converted:

```text
1.x source/config
  -> 2.0 searchable build
  -> new JSON-only index
```

TypeScript imports move to `@ktjn/searchable`; Worker configuration disappears. Python imports/CLI move to `searchable`. Vector/hybrid consumers use lexical retrieval or keep semantic retrieval at application level.

## Testing Layers

1. Unit: analyzers, parser, BM25F, fuzzy, synonyms, facets, phrases, highlighting.
2. Format: validation, deterministic JSON, versions, content-addressed paths.
3. Conformance: one Python-built index, same queries, equivalent Python/TypeScript observable results.
4. Relevance: existing judged domains/languages.
5. Consumers: static hosting, package use, Python use, RAG, section-level docs search.

## Performance Philosophy

Optimize in this order:

1. index only useful content
2. choose good section/document boundaries
3. shard appropriately
4. lazy-load only required shards
5. use immutable HTTP caching/compression
6. reduce allocations/copies
7. optimize in-memory algorithms/data structures
8. document operating ranges
9. only then consider Workers or alternate encodings

Any future architectural optimization proposal must include a representative consumer/workload, measured bottleneck, user-facing impact, simpler alternatives attempted, measured improvement, and permanent complexity cost.

## Security Boundary

All generated index artifacts remain public data when statically deployed. Do not index secrets, unpublished/restricted content, authorization-sensitive metadata, or per-user data. RAG usage does not change this; authorization-sensitive retrieval requires a different server-side architecture.

## ADR and Roadmap Follow-Up

During implementation, update the roadmap, supersede binary/vector/Worker decisions where necessary, and add/replace ADRs for JSON-only storage, lexical-only retrieval, main-thread execution, one distribution per ecosystem, and two-runtime conformance. Preserve old ADRs as history rather than rewriting them.

## Explicit 2.0 Non-Features

- vector/hybrid search
- embeddings/model runtimes
- ANN/HNSW
- Web Worker query execution
- Service Worker cache management
- custom general binary index formats
- query-time backend
- access-controlled search
- browser index mutation
- plugin/storage-adapter architecture
- query planner abstraction
- mandatory WASM
- bundled analytics
- application UI framework

## Success Criteria

Searchable 2.0 can be accurately explained as:

```text
Build rendered content into immutable JSON search files with Python.
Host the files anywhere static files can be served.
Search them with the TypeScript browser client or Python client.
Both clients implement the same BM25F lexical search contract.
```

A new developer should not need to understand Worker protocols, binary codecs, embedding providers, retrieval fusion, Service Workers, or a graph of internal packages before using or contributing to Searchable.

The primary 2.0 metric is the number of concepts removed while keeping real consumers and lexical search quality intact.
