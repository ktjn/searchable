# client-search-framework

A client-side (in-browser) search engine: an offline indexer builds a
sharded, static index; a small JS/WASM runtime fetches only the shards it
needs over plain HTTP and executes ranked, faceted, multi-language search
entirely in the browser. No search server, no query-time backend.

Think "Algolia/Typesense-grade query features, Pagefind/lunr-style
zero-backend deployment."

**Status**: Phases 0, 1, and 2 of the roadmap have working code, and
Phases 3 and 4 are partially built — [`packages/analysis`](packages/analysis)
(shared tokenizer, two `LanguageProfile`s: English + German),
[`packages/format`](packages/format) (shared manifest/shard types),
[`packages/indexer`](packages/indexer) (rendered HTML → manifest +
shards, per-document-language corpus partitioning, configurable field
boosts, `csf-boost`/`csf-facet-<field>`/`csf-pin*` extraction), and
[`packages/client`](packages/client) (fetch + boolean AND + BM25F +
field/term/document boosts + prefix matching + Web Worker execution +
facet filtering with contextual counts + term-to-page pinning +
multi-language query isolation, proven in a real browser via
Playwright, no synonyms/fuzzy/range-or-hierarchy-facets/stemmers/CJK
yet), plus [`spec/`](spec) (JSON Schema + independent Python/TypeScript
reference generators). [`showcase/`](showcase) is a live demo of it
all, deployed to GitHub Pages — this repo's own docs, rendered as a
static site and searched by the real engine (see
[docs/19-github-pages-showcase.md](docs/19-github-pages-showcase.md)).
Everything else below is design docs for phases not yet built — see
[docs/09-roadmap.md](docs/09-roadmap.md#status) for what's done vs.
pending.

```sh
pnpm install
pnpm test                     # 119 Vitest tests across all packages, including real-HTTP e2e tests
pnpm test:browser             # 10 Playwright tests in real Chromium (Worker execution, lifecycle, showcase)
pnpm build                    # builds every package
pnpm --filter showcase build  # renders docs/*.md, builds the search index; serve showcase/dist/ statically
```

Design docs — start here:

| Doc | Contents |
|---|---|
| [docs/00-overview.md](docs/00-overview.md) | Goals, non-goals, guiding principles |
| [docs/01-architecture.md](docs/01-architecture.md) | System components, data flow, deployment model |
| [docs/02-index-format.md](docs/02-index-format.md) | On-disk/over-HTTP index layout, sharding, versioning |
| [docs/03-tokenization-i18n.md](docs/03-tokenization-i18n.md) | Multi-language analysis: tokenizers, stemmers, CJK, stopwords |
| [docs/04-query-ranking-boosts.md](docs/04-query-ranking-boosts.md) | Query syntax, BM25 ranking, field/doc/term boosts, fuzzy & prefix |
| [docs/05-synonyms.md](docs/05-synonyms.md) | Synonym formats, expansion strategy, per-language handling |
| [docs/06-faceted-search.md](docs/06-faceted-search.md) | Facet index structure, counts, ranges, hierarchies |
| [docs/07-client-api.md](docs/07-client-api.md) | Public JS/TS API surface |
| [docs/08-modern-features.md](docs/08-modern-features.md) | Workers/WASM, caching & offline, highlighting, a11y, security, bundle budget |
| [docs/09-roadmap.md](docs/09-roadmap.md) | Phased build plan and open questions |
| [docs/10-testing-and-performance.md](docs/10-testing-and-performance.md) | Regression suite, correctness testing, performance/benchmark suite |
| [docs/11-binary-vs-json-index.md](docs/11-binary-vs-json-index.md) | Investigation: when (if ever) a binary index format pays for itself |
| [docs/12-competitive-landscape.md](docs/12-competitive-landscape.md) | Feature comparison vs Orama, MiniSearch, Lunr, FlexSearch, Pagefind, and what to cherry-pick |
| [docs/13-vector-and-hybrid-search.md](docs/13-vector-and-hybrid-search.md) | Opt-in vector/embedding search and lexical+vector hybrid fusion |
| [docs/14-reference-deployment-cms-2k.md](docs/14-reference-deployment-cms-2k.md) | Concrete target: ~2,000 CMS-sourced documents — sizing, what to simplify, ingestion adapter |
| [docs/15-cms-meta-tag-control.md](docs/15-cms-meta-tag-control.md) | Authoritative reference: every `csf-*` meta tag the CMS uses to control indexing/search |
| [docs/16-term-to-page-pinning.md](docs/16-term-to-page-pinning.md) | Curated "best bets" — pin a specific search term/phrase to a specific page |
| [docs/17-plugin-architecture.md](docs/17-plugin-architecture.md) | The plugin contract: hook points, registration, capability negotiation, versioning |
| [docs/18-resource-aware-loading.md](docs/18-resource-aware-loading.md) | Fetch priority, idle scheduling, network/memory awareness, worker time-slicing |
| [docs/19-github-pages-showcase.md](docs/19-github-pages-showcase.md) | Plan for a live GitHub Pages demo, staged against the roadmap phases |
| [docs/20-tech-stack.md](docs/20-tech-stack.md) | Concrete tooling: TypeScript, Vite, Vitest, Playwright, Python+TypeScript reference generators |
| [docs/21-architecture-principles.md](docs/21-architecture-principles.md) | Long-term architectural invariants (determinism, storage/format independence, small API, ...) |
| [docs/22-project-governance.md](docs/22-project-governance.md) | ADRs, contributor guidelines, compatibility/benchmark/documentation policy |
| [docs/23-implementation-roadmap.md](docs/23-implementation-roadmap.md) | Which major specs to write next, on a separate axis from 09-roadmap.md's build-status phases |
| [docs/24-architecture-recommendations.md](docs/24-architecture-recommendations.md) | Longer-term extensibility/maturity recommendations (query planner, storage abstraction, explain API, ...) |
| [docs/spec-query-planner.md](docs/spec-query-planner.md) | Draft spec: separating query planning from execution |
| [docs/spec-storage-api.md](docs/spec-storage-api.md) | Draft spec: storage-backend abstraction (HTTP, IndexedDB, Service Worker, ...) |
| [docs/spec-plugin-api.md](docs/spec-plugin-api.md) | Draft spec exploring plugin-system goals from a different angle than 17's decided contract |
| [docs/spec-diagnostics.md](docs/spec-diagnostics.md) | Draft spec: explain API, query trace, phase timings, plugin attribution |
| [docs/spec-benchmarking.md](docs/spec-benchmarking.md) | Draft spec: benchmark methodology, corpus profiles, regression policy |
| [docs/spec-binary-format.md](docs/spec-binary-format.md) | Draft spec: binary index physical layout, if/when 11's investigation favors it |

## TL;DR design

- **Indexer** (Node/CLI, offline): ingests documents → analyzes per
  language → builds an inverted index + facet index + doc store → emits
  content-hashed static files (JSON, optionally binary-packed) to a
  `dist/index/` directory you deploy to any static host or CDN.
- **Runtime** (browser, ~10-15KB core + optional plugins): fetches a small
  manifest, then lazily fetches only the term/facet shards a query touches,
  runs analysis + BM25F ranking + boosts + synonym expansion + faceting in
  a Web Worker, and returns ranked hits with highlighted snippets.
- Everything is pull-based over plain HTTP GET — cacheable by any CDN,
  no server-side logic, works from `file://`-adjacent static hosting.
- The index format is an open, documented JSON spec, not a proprietary
  blob — a Python, Node, or Java script can produce a conforming index
  with basic standard-library tooling; the reference indexer is one
  valid producer among many. Core logic favors the simplest data
  structure/algorithm that meets the bar, kept powerful through small,
  independent, testable layers (boosts, synonyms, facets, i18n) rather
  than one monolith. Every layer has correctness and performance tests.
