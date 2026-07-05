# client-search-framework

A client-side (in-browser) search engine: an offline indexer builds a
sharded, static index; a small JS/WASM runtime fetches only the shards it
needs over plain HTTP and executes ranked, faceted, multi-language search
entirely in the browser. No search server, no query-time backend.

Think "Algolia/Typesense-grade query features, Pagefind/lunr-style
zero-backend deployment."

This repository currently contains **design docs only** — no implementation
yet. Start here:

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
