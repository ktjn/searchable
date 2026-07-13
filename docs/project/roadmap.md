# Roadmap

This page is the single current list of shipped capability and remaining work; detailed implementation history and superseded proposals are retained under `docs/archive/`.

## Status

| Area | Current state | Remaining work |
|---|---|---|
| Documentation and showcase | Published, searchable, and covered by link, accessibility, and browser checks | Ongoing maintenance alongside product changes |
| Lexical search | Stable; native six-language relevance regression baseline | Representative domain corpora, broader judged query sets, quality thresholds, and an internal query-planner abstraction |
| Facets, synonyms, fuzzy search, and pins | Stable | No required 1.0 work |
| Internationalization | English, German, Swedish, Dutch, Bokmål, and Nynorsk profiles; fallback segmenters | Additional profiles only with representative corpora and quality gates |
| Offline and worker execution | Stable | Resource-aware loading refinements |
| Binary storage | Term, fuzzy, and document-store codecs | Evaluate remaining shard formats from measured evidence |
| Vector and hybrid search | Optional storage, similarity, and local embeddings implemented | Public semantic showcase and documented scale limits |
| Extensibility and diagnostics | Draft designs archived | Implement only with a concrete consumer |

## Near-term work

- Expand the reproducible native-language relevance baseline with representative domain corpora and reviewed judgments before defining thresholds or making production-scale claims.
- Add a semantic-search example that states model, download, memory, and latency costs clearly; keep lexical search as the default for content sites.
- Expand full language profiles only with representative corpora, analyzer fixtures, relevance queries, and cross-implementation conformance tests.
- Refine loading priority, memory controls, and prefetching from measured browser behavior rather than fixed speculative policies.
- Evaluate any further binary encoding only when lazy access and benchmarks show a meaningful gain over JSON.
- Make ranking parameters configurable only with stable defaults and manifest-recorded configuration so results remain reproducible.
- Add prominent guidance that every generated index artifact is public data and must not contain restricted content.

## Performance and scale evidence

Publish reproducible benchmarks for representative corpus sizes and deployment classes. At minimum, measure:

- cold-cache and warm-cache query latency, including p50 and p95
- bytes fetched per query, total index size, and shard count
- peak browser heap usage and low-end mobile behavior
- prefix, fuzzy, phrase, facet, lexical, vector, and hybrid queries
- vector search across representative vector counts and dimensions

Publish the corpus generator, benchmark configuration, browser versions, and raw results. Use the results to document supported operating ranges, warning thresholds, shard-sizing guidance, and feature-specific costs.

## Relevance quality gates

Treat relevance as a measurable quality attribute rather than only a correctness concern. Maintain judged query sets for representative domains and supported languages, and track metrics such as:

- MRR
- Precision@k
- Recall@k
- nDCG@k
- zero-result rate

The initial deterministic evaluator and small native-source regression suites now cover all six full language profiles. See [Relevance baselines](relevance-baselines.md) for commands, metrics, provenance requirements, and interpretation limits. These fixtures are a regression foundation, not representative corpora or a CI quality gate.

Run relevance evaluation when changing analyzers, tokenization, stemming, synonyms, fuzzy expansion, BM25 parameters, field boosts, phrase behavior, or hybrid fusion. Keep domain-specific relevance suites separate from generic engine conformance tests.

## Language-profile requirements

Add a full language profile only when it includes:

- representative corpus fixtures
- expected tokenization and normalization fixtures
- stopword tests
- stemming or lemmatization tests where applicable
- relevance queries with expected ordering
- TypeScript and Python conformance tests

Fallback segmentation must remain explicit and must not silently apply an unrelated language analyzer.

## Query planning

The query path coordinates retrieval, expansion, filtering, scoring, facets, pins, stored-document loading, and hybrid merging. Introduce an internal query-plan abstraction when concrete performance or maintainability evidence justifies reopening the archived design in [`archive/specs/query-planner.md`](../archive/specs/query-planner.md).

The planner should be able to decide:

- rarest-term-first intersections
- filter pushdown
- shard fetch order
- lexical and vector parallelism
- when full candidate materialization is required
- whether facets require a separate candidate pass
- when top-k early termination is safe

Keep this internal until multiple real consumers require a stable extension API.

## Vector-search boundary

Vector search remains optional. The primary investment for public content sites is lexical relevance, predictable ranking, small downloads, and low browser memory use.

Brute-force vector search is appropriate for small static corpora. Document recommended vector-count limits, expected memory usage, query latency by dimension, model download cost, and browser compatibility. Evaluate quantization, clustering, lexical reranking, HNSW, or WASM-based ANN only when representative benchmarks show a concrete need. Do not make ANN or WASM mandatory dependencies.

## Public-index security boundary

All generated index files are downloadable. Query privacy does not imply corpus confidentiality.

Treat every indexed field, posting, facet value, stored document, synonym, pin, and vector as public data. Do not index unpublished documents, authorization-sensitive metadata, restricted CMS fields, per-user content, secrets, or internal identifiers. Access-controlled search requires a different deployment architecture with server-side authorization and query execution.

## Operational guidance

Document recommended configurations for common deployments such as small documentation sites, medium CMS exports, large public knowledge bases, offline-first applications, lexical-only search, and hybrid search. For each profile, state enabled features, expected index size, shard strategy, cache policy, worker and Service Worker usage, and memory expectations.

## Consumer-driven architecture work

Query planning, a stable third-party plugin API, storage adapters, and deeper diagnostics have archived draft specifications. They are not part of the current public API. Reopen one only for a concrete consumer, update or replace the relevant draft, record an ADR where the architecture changes, and add conformance plus performance evidence.

Related archived material:

- [`archive/specs/query-planner.md`](../archive/specs/query-planner.md)
- [`archive/specs/benchmarking.md`](../archive/specs/benchmarking.md)
- [`archive/roadmaps/architecture-recommendations.md`](../archive/roadmaps/architecture-recommendations.md)

These files are historical design inputs. This roadmap remains the single current source for planned work.

## Explicit non-features

A query-time backend, browser-side index mutation, bundled analytics, mandatory WASM, and an application UI framework are outside the current product boundary. Access-controlled per-user search requires a different deployment architecture.

Historical completed phases are in [`archive/roadmaps/implementation-history.md`](../archive/roadmaps/implementation-history.md). Earlier architecture and release iterations remain in neighboring archived roadmap files.
