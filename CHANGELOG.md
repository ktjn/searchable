# Changelog

All notable changes to `@ktjn/searchable-client`, `@ktjn/searchable-format`, and
`@ktjn/searchable-analysis` are documented here. These three packages are versioned
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

### Added

- `OfflineCacheOptions.scope` (`registerOfflineCaching`) registers the
  offline Service Worker with an explicit scope (docs/guides/offline-search.md).
  Prefer serving `sw.js` at the document root, whose default scope is `/`; a
  script hosted below a broader desired scope must also serve
  `Service-Worker-Allowed` on its response, or the browser rejects the
  registration.

### Changed

- `registerOfflineCaching()` now resolves both `swUrl` and `indexUrl` against
  the page URL at the call boundary, so relative URLs work directly — the
  documented usage — and the Service Worker only ever sees absolute URLs.
- Worker errors preserve their public type: `InvalidManifestError`,
  `VectorSearchNotConfiguredError`, and `VectorProviderMismatchError` come
  back from the Worker as real `instanceof`-compatible instances, carried by a
  stable `code`/`name`/`message` protocol payload (worker-protocol.ts) that
  never includes stack traces.
- A fatal worker failure — a worker `error`, a `messageerror`, or `dispose()`
  — now always terminates and dereferences the worker and settles every
  pending request exactly once, via one internal cleanup path (`#fail`); the
  first failure wins and is never shadowed by a later `dispose()`.
- `ShardCache` caches JSON and binary representations of a URL in separate
  maps, so the two can never collide; failure eviction is likewise
  representation-specific.
- The offline Service Worker's cache-first path reads only its own
  `searchable-offline` cache, never another cache owned by the same origin
  (replacing a global `caches.match()`).

### Fixed

- Abort semantics are race-free: `raceAbort()` honors an already-aborted
  signal, so a synchronous `query` listener that aborts reliably cancels the
  query instead of racing the listener subscription.
- Search event listeners receive a snapshot of the search options; mutating
  the object a `query` listener receives can no longer alter the query that
  executes or what the `result` event reports.
- A Worker whose `init` request fails (invalid manifest, unknown domain
  error, or a protocol mismatch) is now terminated and dereferenced, the
  original error becomes the client's fatal error, and future calls fail
  immediately with it — instead of leaving a doomed Worker referenced
  (worker-protocol.ts handshake below).
- A legacy (version-1) Worker `{ message }` error payload — from a freshly
  deployed `index.js` against a stale cached `worker.js` — now rejects the
  pending request instead of hanging it, and a malformed Worker message can
  never leave a pending request unresolved (the client retires itself
  fatally); the Worker protocol is now versioned (handshake in `init`,
  `docs/reference/compatibility.md#worker-protocol-versions`).
- Cancellation is prompt across every awaited caller-visible operation:
  an abort fires while the client is still initializing (Worker `init` or
  the direct-mode manifest load) or while `embedQuery()` is computing now
  rejects the caller immediately — the shared init/embedding keeps running
  for others, and no `result` event or `onPartial` is delivered after an
  abort.
- Search event listeners receive a *deep-enough* snapshot of the search
  options: filter arrays and `{min, max}` range objects (not just the
  `filters`/`boosts`/`facets` containers) are copied, so mutating anything
  a `query` listener receives — `filters.category.push(...)`,
  `filters.price.min = ...`, deleting a filter, nested boosts, the facet
  list — can no longer alter the query that executes or the `result` event
  payload.
- The offline Service Worker's installation is now atomic: every referenced
  shard is fetched, validated, and written before the manifest entry is
  replaced (the manifest is the install's commit marker), so a failed
  install leaves the previously active index fully operational offline
  (docs/guides/offline-search.md).
- Stale-while-revalidate now awaits the successful network response's
  `cache.put()` before the refresh settles, so `waitUntil()` genuinely
  covers cache persistence; failed or non-OK responses are never written
  and never replace an existing good cached entry.

### Security

- `SECURITY.md` now reflects the public, released state: supported release
  lines, private vulnerability reporting, scope (browser runtime, index
  format, Python and npm packages), the public-index confidentiality
  boundary, and the release-artifact smoke test that runs before PyPI
  publication.

## [1.1.2] - 2026-08-06

This release is `1.1.2` for the npm packages, `0.2.2` for `searchable-indexer`
and `searchable-analysis`, `0.4.1` for the Python client, and the first PyPI
publish of the new `searchable-binary` `0.1.0` package.

### Changed

- Internal-only: the binary shard codecs (term/fuzzy shards and the document
  store) now live in a single shared home, the new `searchable-binary` package,
  used by both the Python indexer (writer) and the Python client (reader) so a
  format change is a single edit per language. `searchable-client` and
  `searchable-indexer` now depend on it; the publish workflow learns to ship it
  to PyPI so both artifacts remain installable.
- Internal-only cleanup: the TypeScript and Python clients were split into
  focused modules (fuzzy, facets, hybrid, phrase, synonyms, doc store, ...) by
  cross-package dedup, the gallery/pipeline walkers were deduplicated, and the
  relevance suites' v1/v2 load/run paths were unified. None of this changes the
  published API surface or the index format.

### Notes

- No functional changes to the published API or the `Manifest.version` contract
  (`1`); this patch bump releases the internal restructuring and the first
  `searchable-binary` artifact.


This release is `1.1.1` for the npm packages, `0.2.1` for `searchable-indexer`
and `searchable-analysis`, and `0.4.0` for the Python client.

### Added

- `SearchOptions.operator` (`"and"` | `"or"`, default `"and"`, unchanged
  existing behavior) in both Python and TypeScript `searchable-client` lets
  lexical search match documents containing *any* query term rather than
  requiring every term slot to match the same document. Ranking still favors
  documents matching more terms via the existing per-clause score summation.
- Multilingual stopword lists for all 12 supported languages (English, German,
  Swedish, Dutch, Norwegian, Chinese, Japanese, Thai, Khmer, Lao) in both
  Python and TypeScript analysis modules.

### Fixed

- `searchable-analysis` `0.2.1` (Python) and `@ktjn/searchable-analysis` `1.1.1`
  (TypeScript): `LanguageProfile` now populates `stopwords` with standard
  function/interrogative word lists. `analyze()` already filtered stopwords when
  present; previously every language profile simply shipped an empty set.
  A query like "what does additive mean" against a small, formal-prose corpus
  previously required every one of those tokens to co-occur in the same document
  for a lexical `"and"`-mode match — and even where a document did match,
  BM25's corpus-relative IDF could rank documents containing common function
  words above documents actually about the query's real subject. Both effects
  are now avoided by dropping them at analysis time, for indexing and querying
  alike. Reported via a Modelable CLI/Playground chat RAG bug where an unmatched
  natural-language question silently fell through to an ungrounded answer.

### Notes

- `searchable-indexer` `0.2.1` and the npm packages `@ktjn/searchable-format`
  and `@ktjn/searchable-analysis` have functional changes in this release
  (multilingual stopwords); the version bump lets the tag-triggered publish
  workflow publish each artifact exactly once.

## [1.1.0] - 2026-08-01

This release is `1.1.0` for the npm packages, `0.2.0` for `searchable-indexer`
and `searchable-analysis`, and `0.3.0` for the Python client.

### Added

- Structured document-store binary v2 for `build_index_documents()` with
  `doc_store_format="binary"`, preserving URL, boost, external ID, content hash,
  JSON metadata, and stored fields across Python and TypeScript clients.
- Cross-language and real-browser Worker/Service Worker conformance coverage;
  legacy binary v1 and JSON remain supported and JSON remains the default.

## [1.0.5] - 2026-07-31

This release publishes the merged Python vector and hybrid query support.

- `searchable-client` `0.2.0`: injected query embeddings, vector shard
  loading, cosine search, best-passage collapse, hybrid RRF, and explicit
  provider/configuration errors.
- Patch releases for the compatible npm packages (`1.0.1`) and Python
  analysis/indexer packages (`0.1.1`) allow the tag-triggered publish workflow
  to publish each artifact exactly once.

### Python `searchable-client` 0.2.0

- Added injected `embed_query` support for vector and hybrid search against
  the shared Searchable vector-shard format, including int8 dequantization,
  cosine ranking, one best passage per document, and Reciprocal Rank Fusion.
- Added provider compatibility checks and explicit errors for missing vector
  configuration, unavailable shards, malformed vectors, and dimension
  mismatches. No embedding-model dependency was added.

The npm packages are published to GitHub Packages and the Python packages are
published to PyPI from tagged releases. The entries below preserve the
historical `1.0.0` feature summary.

### Historical 1.0.0 feature summary

This is the feature summary for the first stable release.

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
- **Index generator** (`searchable-indexer`, Python, `python/searchable-indexer`):
  parses rendered HTML via
  the [`searchable-*` meta-tag control surface](docs/reference/cms-meta-tags.md) and emits a
  content-hashed manifest + shards.
- Five retroactive ADRs (`docs/adr/`) recording the transport, index
  format, ranking model, compatibility policy, and plugin/opt-in-tier
  decisions above.
- **Relevance domain corpora**: a reviewed German-language judged relevance
  domain corpus (`de-fahrerlaubnisrecht`, 23 German Wikipedia driving-license-law
  pages, 19 queries), alongside the existing documentation and GOV.UK
  learner-driving corpora, evaluated by the deterministic offline relevance
  evaluator (docs/project/relevance-baselines.md).
- **Faceted relevance domain corpus**: a reviewed Project Gutenberg
  public-domain fiction corpus (`gutenberg-fiction-facets`, 30 books, 20
  queries, `genre` terms facet + `year` range facet), the first domain suite
  to judge relevance under real facet-filtered search — including a combined
  genre-and-year intersection query — alongside the existing documentation,
  GOV.UK, and German corpora (docs/project/relevance-baselines.md).

### Changed

- **GOV.UK relevance corpus expanded to real-query-derived phrasing**:
  `govuk-learn-to-drive` bumped `1.0.0` → `1.1.0` (20 → 28 queries, 22
  documents unchanged). The 8 added queries are sourced from Google's public
  autocomplete suggestion endpoint as real-search-language phrasing
  inspiration — not a licensed dataset, and not GOV.UK query-log evidence
  (GOV.UK does not publish query logs) — and are hand-graded and reviewed
  like the rest of the suite. The reviewed `k = 5` baseline improves on every
  metric but recall versus `1.0.0` (MRR 0.650000 → 0.732143, Precision@5
  0.160000 → 0.171429, Recall@5 0.475000 → 0.464286, nDCG@5 0.585738 →
  0.642698, zero-result rate 0.300000 → 0.214286) despite the added queries
  being harder and more naturally phrased (docs/project/relevance-baselines.md).

### Notes

- The core runtime bundle (`index.js` + `worker.js` + `sw.js`) is held
  to a 15 KB gzip budget, enforced in CI (`pnpm size`).
- Vitest and Playwright real-browser tests cover the above end-to-end, not just
  in isolation; CI is the source of truth for the current test count.
- See [docs/project/roadmap.md](docs/project/roadmap.md) for exactly what's built
  vs. still partial/design-only, and
  [docs/reference/compatibility.md](docs/reference/compatibility.md) for what's
  deliberately out of scope for this release.
