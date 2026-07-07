# client-search-framework

A client-side (in-browser) search engine: an offline indexer builds a
sharded, static index; a small JS/WASM runtime fetches only the shards it
needs over plain HTTP and executes ranked, faceted, multi-language search
entirely in the browser. No search server, no query-time backend.

Think "Algolia/Typesense-grade query features, Pagefind/lunr-style
zero-backend deployment."

## Quick start

```sh
npm install @csf/indexer @csf/client
```

Build the index from your already-rendered HTML (a static site export, a
prerendered SPA, whatever your build already produces):

```sh
npx csf-indexer ./dist/site ./dist/site/search-index
```

Deploy `./dist/site` (including `search-index/`) to any static host, then
search from the browser:

```html
<script type="module">
  import { SearchClient } from "@csf/client";

  const client = new SearchClient({
    indexUrl: "/search-index/manifest.json",
  });

  const result = await client.search("widgets");
  for (const hit of result.hits) {
    console.log(hit.url, hit.fields.title, hit.score);
  }
</script>
```

That's the whole integration: no server, no build-time coupling beyond
running the indexer once per content change. See
[docs/07-client-api.md](docs/07-client-api.md) for the full `search()`
options (facets, filters, boosts, fuzzy matching, highlighting, `mode:
"vector"`/`"hybrid"`, streaming results, cancellation, and more) and
[docs/15-cms-meta-tag-control.md](docs/15-cms-meta-tag-control.md) for
every `csf-*` meta tag your pages can use to control indexing.

## Production checklist

- **Cache headers**: every shard file the indexer emits is content-hashed
  (e.g. `terms/en/w.7f3c.json`) — serve those
  `Cache-Control: public, max-age=31536000, immutable`. The one unhashed
  file, `manifest.json`, is what changes on every rebuild — serve it with
  a short or no cache lifetime so clients actually pick up a new build
  (see [docs/02-index-format.md#versioning--cache-strategy](docs/02-index-format.md#versioning--cache-strategy)).
- **Worker URL**: pass `workerUrl` pointing at wherever your build
  actually deploys `@csf/client`'s built `worker.js` — this is
  deliberately not auto-resolved, since every bundler has its own
  incompatible convention for referencing a sibling worker file from a
  library. Omit it to run on the main thread instead (same API either
  way).
- **Service Worker URL** (optional, for offline support): same
  deployment concern as the worker above, for whatever URL you register
  via `registerOfflineCaching()` — see
  [docs/08-modern-features.md#caching--offline-support](docs/08-modern-features.md#caching--offline-support).
- **CSP**: this library never uses `eval`/inline scripts and only talks
  to your own static host over plain `fetch()`; if you register the
  Worker/Service Worker above, make sure your `script-src`/`worker-src`
  policy allows loading them from wherever you deployed them.
- **Index rebuild trigger**: re-run `csf-indexer` (or your own
  `buildIndex()`/`writeIndex()` call) as a step in whatever pipeline
  already rebuilds your site's content — there's no incremental update
  mechanism yet (see [docs/09-roadmap.md](docs/09-roadmap.md)'s "open
  questions"), a full rebuild is fast and simple enough that no
  deployment has needed one so far.
- **Bundle-size expectations**: the core runtime (`index.js` + `worker.js`
  + `sw.js`) is held to a 15KB gzip budget, enforced in this repo's own
  CI — everything else (real embedding-model integration, the binary
  storage tier, offline caching) is opt-in and only costs bytes if you
  actually use it. See
  [docs/08-modern-features.md#bundle-size-budget](docs/08-modern-features.md#bundle-size-budget).

## Status

The core engine is implemented and tested end-to-end: multi-language
lexical search (BM25F, boosts, prefix/phrase matching), facets (terms,
range, hierarchical), synonyms, fuzzy/typo-tolerant matching, term-to-page
pinning, result highlighting, Web Worker execution, offline Service
Worker caching, an opt-in vector/hybrid search mode with real local-model
embedding support, and an opt-in binary storage tier for larger corpora.
[`showcase/`](showcase) is a live demo of all of it, deployed to GitHub
Pages — this repo's own docs site searched by the real engine, plus a
feature gallery (product catalog with facets/boosts/pins/fuzzy matching,
a synonym playground, a multi-language corpus).

For the full phase-by-phase build status (what's done, what's partial,
what's still design-only) see
[docs/09-roadmap.md](docs/09-roadmap.md#status) — the authoritative,
continuously-updated source of truth, not duplicated here.

```sh
pnpm install
pnpm test                     # 496 Vitest tests across all packages, including real-HTTP e2e tests
pnpm test:browser             # 40 Playwright tests in real Chromium (Worker execution, lifecycle, offline caching, showcase, feature gallery)
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
| [docs/23-implementation-roadmap.md](docs/23-implementation-roadmap.md) | Which major specs are written vs. still remaining (Ranking Framework, Memory Model), on a separate axis from 09-roadmap.md's build-status phases |
| [docs/24-architecture-recommendations.md](docs/24-architecture-recommendations.md) | Longer-term extensibility/maturity recommendations not yet spec'd (performance budgets, iterator-based execution, corpus validation, ...) |
| [docs/25-path-to-1.0.md](docs/25-path-to-1.0.md) | Release-engineering iteration plan for a 1.0: API freeze, versioning, publish pipeline, hardening pass |
| [docs/26-example-configurations.md](docs/26-example-configurations.md) | Complete indexer + client configuration recipes per deployment scenario (catalog, i18n, offline, semantic search, ...) |
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
