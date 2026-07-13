# Changelog

All notable changes to `@ktjn/searchable-client`, `@ktjn/searchable-indexer`, `@ktjn/searchable-format`, and
`@ktjn/searchable-analysis` are documented here. These four packages are versioned
in lockstep (see [Compatibility](docs/reference/compatibility.md)) — one
version number covers all of them.
`@ktjn/searchable-fixtures` is internal test tooling and is never published, so it
isn't covered by this changelog.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/), scoped to
the "stable" API surface in
[package semver policy](docs/reference/compatibility.md#package-semver) —
the vector/hybrid search and binary storage tier surfaces
are explicitly marked experimental and may change in a minor release.

## [Unreleased]

The npm packages are not yet published. Their manifests and implemented API
surface are prepared for a coordinated first release at `1.0.0`.

### Prepared for 1.0.0

This is the feature summary for the planned first stable release. Everything
below was built and tested across prior unreleased commits.

### Added

- **Lexical search core**: multi-language tokenization/analysis
  (`@ktjn/searchable-analysis`), BM25F ranking with field/document/term boosts
  (docs/guides/ranking-and-boosts.md), prefix (`term*`) and exact `"quoted phrase"` matching.
- **Facets & curated results**: terms, range (filter + aggregate
  bucket), and hierarchical facets; a filter-only `facetValues()` call;
  term-to-page pinning (docs/guides/pinning.md) with priority/exclusive-mode
  resolution.
- **Relevance aids**: query-time synonym expansion (single-word,
  directional, and phrase-level `multiWord`), SymSpell fuzzy/typo
  matching with "did you mean" suggestions.
- **Internationalization**: real English (Porter), German, Swedish, Dutch,
  and Norwegian Bokmål/Nynorsk (Snowball) stemmers; CJK bigram and Thai/Khmer/Lao trigram segmentation
  fallbacks, zero-bundled-model auto language detection, an
  `isRtlLanguage()` primitive.
- **Runtime/DX**: Web Worker execution (`@ktjn/searchable-client/worker`) with a
  main-thread fallback, `options.signal` cancellation, `searchStream()`
  incremental results, result highlighting, `on("query"|"result")`
  observability hooks.
- **Offline support**: Service Worker precaching
  (`registerOfflineCaching()`, `@ktjn/searchable-client/sw`), including
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
  ([Compatibility](docs/reference/compatibility.md#index-format-compatibility)).
- **Reference indexer CLI** (`searchable-indexer`): parses rendered HTML via
  the [`searchable-*` meta-tag control surface](docs/reference/cms-meta-tags.md) and emits a
  content-hashed manifest + shards.
- Five retroactive ADRs (`docs/adr/`) recording the transport, index
  format, ranking model, compatibility policy, and plugin/opt-in-tier
  decisions above.

### Notes

- The core runtime bundle (`index.js` + `worker.js` + `sw.js`) is held
  to a 15 KB gzip budget, enforced in CI (`pnpm size`).
- Vitest and Playwright real-browser tests cover the above end-to-end, not just
  in isolation; CI is the source of truth for the current test count.
- See [docs/project/roadmap.md](docs/project/roadmap.md) for exactly what's built
  vs. still partial/design-only, and
  [docs/reference/compatibility.md](docs/reference/compatibility.md) for what's
  deliberately out of scope for this release.
