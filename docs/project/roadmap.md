# Roadmap

This page is the single current list of shipped capability and remaining work; detailed implementation history and superseded proposals are retained under `docs/archive/`.

## Status

| Area | Current state | Remaining work |
|---|---|---|
| Documentation and showcase | Published, searchable, and covered by link, accessibility, and browser checks | Ongoing maintenance alongside product changes |
| Lexical search | Stable; native six-language regression baseline plus reviewed documentation, GOV.UK learner-driving, and German (`de-fahrerlaubnisrecht`) domain corpora | Broader representative domains and judged sets, real query evidence, quality thresholds, and an internal query-planner abstraction |
| Facets, synonyms, fuzzy search, and pins | Stable | No required 1.0 work |
| Internationalization | English, German, Swedish, Dutch, Bokmål, and Nynorsk profiles; fallback segmenters | Additional profiles only with representative corpora and quality gates |
| Offline and worker execution | Stable | Bounded shard caching and documented memory behavior; resource-aware loading refinements |
| Binary storage | Term, fuzzy, and document-store codecs | Reader bounds-check hardening with malformed-payload tests to match the documented guarantee; evaluate remaining shard formats from measured evidence |
| Index format and conformance | JSON schemas under `spec/` with Python-side output validation and independent example generators | TypeScript-side schema validation of indexer output so the schemas remain the normative contract for both producers |
| Vector and hybrid search | Optional storage, similarity, and local embeddings implemented | Public semantic showcase and documented scale limits |
| Performance and scale | One reviewed CMS-2k Chromium main-thread lexical vertical baseline with raw JSON evidence | Broader sizes, browsers, execution modes, query classes, operating guidance, and CI comparison |
| Extensibility and diagnostics | Draft designs archived | Implement only with a concrete consumer |
| Release engineering | Full CI reused as a publish gate, provenance workflow, enforced bundle budget | Tarball inspection and consumer smoke test, manifest hardening, tag/version automation, Python dependency coverage |

## Near-term work

- Expand relevance coverage beyond the documentation, learner-driving, and German driving-license-law domains — now spanning English and German — with broader judged sets and real query evidence before defining thresholds or making production-scale claims.
- Add a semantic-search example that states model, download, memory, and latency costs clearly; keep lexical search as the default for content sites.
- Expand full language profiles only with representative corpora, analyzer fixtures, relevance queries, and cross-implementation conformance tests.
- Refine loading priority, memory controls, and prefetching from measured browser behavior rather than fixed speculative policies.
- Evaluate any further binary encoding only when lazy access and benchmarks show a meaningful gain over JSON.
- Make ranking parameters configurable only with stable defaults and manifest-recorded configuration so results remain reproducible.
- Add prominent guidance that every generated index artifact is public data and must not contain restricted content.

## Release and engineering hardening

Findings from the July 2026 repository review, recorded here so this page remains the single list of remaining work. Complete the pre-release items before tagging `v1.0.0`.

Before the first release:

- Validate TypeScript indexer output against `spec/schema/*.schema.json` in tests. Only `python/searchable-indexer/tests/test_schema_conformance.py` checks the schemas today, leaving the normative contract unenforced for the reference TypeScript producer.
- Add bounds checks to the client binary readers (`readBytes` currently clamps silently past the buffer end and `readVarint` has no overflow guard) plus malformed- and truncated-payload tests, matching the guarantee [Binary storage](../concepts/binary-storage.md) states.
- Add a package-artifact gate to the publish pipeline: `pnpm pack`/`--dry-run` tarball inspection and a consumer smoke test that installs the tarballs and imports each package, as [Project governance](governance.md) requires.
- Harden the publishable manifests: `publishConfig.access`, `sideEffects`, `publint`/`attw` checks, declarations or explicit untyped-script documentation for the `worker`/`sw` entries, and no `declarationMap` output pointing at unshipped `src/` paths.
- Commit a `uv.lock` for `python/searchable-analysis` (the indexer already has one) and add the `uv` ecosystem to Dependabot for both Python packages.

After the first release:

- Add a tag/version guard and version-bump automation for the lockstep packages; move npm authentication from a long-lived token to trusted publishing (OIDC).
- Test the supported runtime range in CI: Node floor and latest, Python 3.10 through 3.14 against `requires-python`.
- Add coverage reporting to expose thin test spots; add direct unit tests for the TypeScript indexer CLI, discovery, and hashing to match the Python port's coverage.
- Bound the client shard cache or expose explicit clearing, and document expected memory behavior per deployment profile (part of the resource-aware loading work above).
- Hygiene: prune stale worktrees, sweep phase-era comments that describe development history instead of current behavior, add READMEs to the internal packages, and add the missing `engines` field to `packages/fixtures`.

## Performance and scale evidence

The first reviewed vertical baseline now measures the deterministic CMS-2k
corpus with the real indexer and a strict main-thread client in headless
Chromium. It records cold and warm p50/p95 latency, fetched bytes,
gzip-equivalent artifact sizes, shard counts, and explicit heap availability.
See [Performance baseline](performance-baseline.md) for the environment,
commands, query definitions, interpretation limits, and reviewed raw JSON.

This is one narrow evidence point, not complete performance-and-scale coverage.
Keep the following work open:

- multiple corpus sizes and deployment classes
- Firefox, WebKit, and low-end mobile measurements
- worker, Service Worker, and browser-cache-warm modes
- prefix, fuzzy, phrase, facet, vector, and hybrid expansion beyond the current six-query slice
- supported operating ranges, shard-sizing guidance, and warning thresholds
- CI benchmark comparison and enforcement

Add each dimension only with a fixed workload, recorded environment, raw
evidence, and explicit interpretation boundary. Do not infer a budget or
supported range from the current single-machine run.

## Relevance quality gates

Treat relevance as a measurable quality attribute rather than only a correctness concern. Maintain judged query sets for representative domains and supported languages, and track metrics such as:

- MRR
- Precision@k
- Recall@k
- nDCG@k
- zero-result rate

The deterministic evaluator and small native-source regression suites cover all
six full language profiles, and three reviewed domains supply graded multi-page
judgments: the 29-page documentation corpus, the 22-page GOV.UK
learner-driving journey, and the 23-page German (`de-fahrerlaubnisrecht`)
driving-license-law corpus. See [Relevance
baselines](relevance-baselines.md) for commands, metrics, provenance
requirements, and interpretation limits. These remain narrow representative
domains, not broad domain coverage or a CI quality gate. Quality thresholds,
broader performance evidence, query-planning work, and CI enforcement remain
open.

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
