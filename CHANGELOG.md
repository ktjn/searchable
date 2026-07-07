# Changelog

All notable changes to `@csf/client`, `@csf/indexer`, `@csf/format`, and
`@csf/analysis` are documented here. These four packages are versioned
in lockstep (see [docs/25-path-to-1.0.md](docs/25-path-to-1.0.md)'s
Iteration 3) — one version number covers all of them.
`@csf/fixtures` is internal test tooling and is never published, so it
isn't covered by this changelog.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/), scoped to
the "stable" API surface in
[docs/25-path-to-1.0.md](docs/25-path-to-1.0.md#iteration-1--api-surface-audit--freeze)'s
export table — the vector/hybrid search and binary storage tier surfaces
are explicitly marked experimental and may change in a minor release.

## [1.0.0]

First stable release. Everything below was already built and tested
across many prior (unreleased, `0.0.0`) commits; this entry is the
retroactive summary the [Release Quality Checklist](docs/22-project-governance.md#release-quality-checklist)
calls for, written once at the point the packages actually gain a real
version number.

### Added

- **Lexical search core**: multi-language tokenization/analysis
  (`@csf/analysis`), BM25F ranking with field/document/term boosts
  (docs/04), prefix (`term*`) and exact `"quoted phrase"` matching.
- **Facets & curated results**: terms, range (filter + aggregate
  bucket), and hierarchical facets; a filter-only `facetValues()` call;
  term-to-page pinning (docs/16) with priority/exclusive-mode
  resolution.
- **Relevance aids**: query-time synonym expansion (single-word,
  directional, and phrase-level `multiWord`), SymSpell fuzzy/typo
  matching with "did you mean" suggestions.
- **Internationalization**: real English (Porter) and German (Snowball)
  stemmers, CJK bigram and Thai/Khmer/Lao trigram segmentation
  fallbacks, zero-bundled-model auto language detection, an
  `isRtlLanguage()` primitive.
- **Runtime/DX**: Web Worker execution (`@csf/client/worker`) with a
  main-thread fallback, `options.signal` cancellation, `searchStream()`
  incremental results, result highlighting, `on("query"|"result")`
  observability hooks.
- **Offline support**: Service Worker precaching
  (`registerOfflineCaching()`, `@csf/client/sw`), including
  stale-while-revalidate and language-scoped caching.
- **Scale options** (experimental): an opt-in, per-shard binary encoding
  for term shards, fuzzy shards, and the doc store
  (`termShardFormat`/`fuzzyShardFormat`/`docStoreFormat: "binary"`),
  real per-prefix term sharding, and doc-store multi-shard splitting
  (`docStoreShardSize`).
- **Vector & hybrid search** (experimental): chunking, int8/float32
  vector shards, brute-force cosine similarity, Reciprocal Rank Fusion,
  `search(query, { mode: "vector" | "hybrid" })`, and real local-model
  embedding integration via `@huggingface/transformers`
  (`createTransformersEmbedder`/`createTransformersEmbedQuery`).
- **Validation & compatibility**: `validateManifest()` rejects a
  structurally invalid, cross-origin-shard, or unsupported-`version`
  manifest with a named `InvalidManifestError` before any query runs
  (docs/02#versioning--cache-strategy).
- **Reference indexer CLI** (`csf-indexer`): parses rendered HTML via
  the `csf-*` meta-tag control surface (docs/15) and emits a
  content-hashed manifest + shards.
- Five retroactive ADRs (`docs/adr/`) recording the transport, index
  format, ranking model, compatibility policy, and plugin/opt-in-tier
  decisions above.

### Notes

- The core runtime bundle (`index.js` + `worker.js` + `sw.js`) is held
  to a 15 KB gzip budget, enforced in CI (`pnpm size`).
- 496 Vitest tests and 40 Playwright (real-Chromium) tests cover the
  above end-to-end, not just in isolation.
- See [docs/09-roadmap.md](docs/09-roadmap.md) for exactly what's built
  vs. still partial/design-only, and
  [docs/25-path-to-1.0.md](docs/25-path-to-1.0.md) for what's
  deliberately out of scope for this release.
