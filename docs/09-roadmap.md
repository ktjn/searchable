# Roadmap & Open Questions

## Status

Phases 0, 1, and 2 have working code in this repo (`packages/`,
`spec/`), not just design docs — see each phase below for what's
actually implemented vs. still pending. Phase 3+ remain design-only.
The GitHub Pages showcase's first two stages ([`showcase/`](../showcase/))
are also built — search these docs for real, right now (locally; live
deployment needs a one-time Pages setting flipped in this repo's
GitHub settings). Stages 2-3 remain blocked on later phases.

## Phased build plan

**Phase 0 — Spec & fixtures**
- ✅ Manifest/shard JSON Schema frozen as machine-checkable files:
  [`spec/schema/`](../spec/schema/) (manifest, term shard, facet shard,
  doc store shard, synonym shard, pins shard).
- ✅ Two independent reference generators proving the format needs no
  library buy-in — [`spec/examples/`](../spec/examples/)
  (Python + TypeScript), verified byte-for-byte structurally identical
  output and schema-valid against the files above.
- ⬜ Small multi-language fixture corpus (English, German, Japanese,
  Arabic at minimum) grounded in a real ~2,000-document CMS export (see
  [14-reference-deployment-cms-2k.md](14-reference-deployment-cms-2k.md))
  — not yet built; current tests use small inline HTML fixtures instead.

**Phase 1 — Minimal viable engine (single language, JSON tier only)**
- ✅ Reference indexer — [`packages/indexer/`](../packages/indexer/):
  parses rendered HTML (title, `<main>`/body-minus-boilerplate,
  `csf-noindex`, `data-csf-body`/`data-csf-ignore`, canonical URL, meta
  description) per the `csf-*` meta-tag control surface
  ([15-cms-meta-tag-control.md](15-cms-meta-tag-control.md)), tokenizes
  via the shared [`packages/analysis/`](../packages/analysis/) package,
  emits a content-hashed manifest + single term shard + doc store shard
  (English only, unsharded — "small corpus mode").
- ✅ Browser runtime — [`packages/client/`](../packages/client/):
  manifest + shard fetch over plain HTTP (proven against a real, if
  tiny, HTTP server in tests, not just direct filesystem access),
  boolean AND query evaluation, full BM25F scoring (docs/04) with
  field boosts defaulting to 1.0 until Phase 2 sets real weights. No
  Worker yet (main thread), no fuzzy/synonyms/facets/pins plugins yet.
- ✅ Goal met: an end-to-end Vitest suite
  ([`packages/client/test/e2e.test.ts`](../packages/client/test/e2e.test.ts))
  builds a real index and queries it back over real HTTP, proving the
  shard-fetch-on-demand model works, not just each half in isolation.

**Phase 2 — Ranking & boosts**
- ✅ Field boosts: configurable at build time
  (`buildIndex(sources, lang, { fieldBoosts })`, defaulting to
  title=3.0/body=1.0) and overridable per-query
  (`search(query, { boosts: { fields } })`).
- ✅ Term boosts: `search(query, { boosts: { terms } })` multiplies one
  specific query term's score contribution.
- ✅ Document boosts: `csf-boost` meta tag, applied as a final
  per-document multiplier (see Phase 1's `len` note — `boost` is
  denormalized onto term-shard postings the same way, for the same
  reason: it must be known before the doc-store fetch, not after).
- ✅ Prefix matching (`term*`): query parsing splits on raw whitespace
  before analysis (so a trailing `*` survives tokenization), then
  expands against the already-fetched term dictionary.
- ✅ Web Worker execution: `worker.ts` runs the same `search()` code the
  main thread does, via a minimal hand-rolled request/response protocol
  (`worker-protocol.ts`) — not Comlink, since the whole message surface
  is one method. `SearchClient` takes an explicit `workerUrl` rather
  than trying to auto-resolve its sibling `worker.js`: that pattern
  (`new Worker(new URL("./worker.js", import.meta.url))`) looks natural
  but every bundler statically detects and rewrites it under its own
  app-bundling assumptions — Vite in particular either hardcodes an
  absolute `/assets/...` path (wrong for a library at an arbitrary base
  path) or, worse, inlines raw unbundled TypeScript source as a base64
  `data:` URL. An explicit `workerUrl` sidesteps every bundler's
  incompatible convention at once. Proven correct in an actual browser
  (Playwright/Chromium, not Node/Vitest, since Node has no `Worker`
  global to meaningfully exercise this) — see
  [`packages/client/e2e-browser/worker.spec.ts`](../packages/client/e2e-browser/worker.spec.ts).
- All of the above verified with real end-to-end tests (not just unit
  tests) proving the ranking/boost/worker effect actually changes what
  the real client returns, not just that the scoring function's math
  looks right in isolation or the protocol's shape typechecks. 51
  Vitest tests + 3 real-browser Playwright tests passing.

Phase 2 is now fully implemented.

**Phase 3 — Facets & curated pins**
- Facet shard format, filtering, contextual counts, range facets.
- Term-to-page pinning ([16-term-to-page-pinning.md](16-term-to-page-pinning.md)),
  grouped with facets because pin display must respect active facet
  filters — the two features share the "apply after/alongside the
  candidate set, before final result assembly" slot in the query
  pipeline, so building them together avoids a rework of that seam.

**Phase 4 — I18n**
- LanguageProfile abstraction, additional stemmers, `Intl.Segmenter`
  integration, CJK bigram fallback, per-language partitions.

**Phase 5 — Synonyms & fuzzy**
- Query-time synonym expansion.
- SymSpell fuzzy plugin, "did you mean".

**Phase 6 — Modern features polish**
- Streaming results, highlighting, offline/Service Worker plugin,
  bundle-size CI gate, accessibility pass, observability hooks.

**Phase 7 — Scale options**
- Binary tier codec (plus a Range-request-capable single-file postings
  variant), benchmarked against JSON at 10k/100k/1M synthetic corpus
  sizes to empirically set the size/density threshold where it's worth
  switching — see the investigation in
  [11-binary-vs-json-index.md](11-binary-vs-json-index.md) — optional
  WASM scoring core, federated multi-index search, and the independent
  Python reference generator ([20-tech-stack.md](20-tech-stack.md#reference-index-generators-python-and-typescript),
  [10-testing-and-performance.md](10-testing-and-performance.md)) to
  prove the format is genuinely implementation-agnostic and not just
  agnostic in principle, alongside the TypeScript reference indexer
  already built in Phase 1.

**Phase 8 — Vector & hybrid search**
- Embedding shard format, chunking, quantization (int8 default), brute-
  force cosine similarity scoring, RRF-based hybrid fusion with lexical
  BM25F results, opt-in coarse clustering for larger corpora. Full design
  in [13-vector-and-hybrid-search.md](13-vector-and-hybrid-search.md).
  Deliberately sequenced after the lexical engine is proven out (Phases
  1-6), since it's additive, higher-complexity, and depends on choices
  (embedding model, quantization thresholds) best validated against a
  working baseline rather than upfront.

**Showcase (runs alongside, not a phase of its own)**
- A GitHub Pages demo is staged against the phases above rather than
  built all at once — see
  [19-github-pages-showcase.md](19-github-pages-showcase.md).
  - ✅ Stage 0 (docs site) — [`showcase/`](../showcase/): every
    `docs/*.md` + `README.md` rendered to a small static site (nav,
    cross-link rewriting), no framework.
  - ✅ Stage 1 ("search these docs") — the real `@csf/indexer` runs
    against Stage 0's rendered output, the real `@csf/client` (Worker
    execution included) powers a search box on every page. Verified in
    a real browser via Playwright, including at a Pages-style subpath
    deployment (`/repo-name/`, not domain root) — which caught a real
    bug (a dynamic `import()` resolving against its own module's URL,
    not the page's) that testing only at server root would have missed.
    Deploys via
    [`.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml)
    on every push to `main`; actually publishing still needs Settings →
    Pages → "GitHub Actions" enabled once, a manual repo-admin step.
  - ⬜ Stage 2 (feature gallery: product catalog for facets/boosts/pins,
    synonym playground, multi-language corpus, typo-tolerance demo):
    needs facets/pins (Phase 3), i18n (Phase 4), synonyms/fuzzy
    (Phase 5) — still blocked on those.
  - ⬜ Stage 3 (semantic search demo): needs Phase 8 — still blocked.

Each phase should be shippable/usable on its own (e.g. Phase 1 alone is
already a usable, if basic, client-side search engine) — this is
sequencing for incremental value, not a waterfall gate.

## Open questions

- **Incremental index updates.** Today, any content change means a full
  rebuild + republish. Is a "patch" format (diff of postings since last
  build) worth the complexity for large corpora with frequent small
  edits, or is "just rebuild, it's fast and cheap" good enough given
  target corpus sizes? Leaning toward the latter until a concrete
  use case proves otherwise — full rebuilds keep the whole system much
  simpler (see the simplicity principle in
  [00-overview.md](00-overview.md)).
- **Personalization/ML ranking.** Out of scope for the core (see
  non-goals), but should the API leave a documented extension point
  (e.g. a client-side re-ranking hook fed a feature vector per hit) so
  consumers can layer their own signals without forking the engine?
- ~~**Vector/semantic search.**~~ Resolved into a concrete design — see
  [13-vector-and-hybrid-search.md](13-vector-and-hybrid-search.md) and
  Phase 8 above. Remaining open sub-question: whether shipping a
  client-side embedding model (tens of MB) is an acceptable default cost
  for deployments that enable `plugin:vector`, or whether the remote-API
  escape hatch ends up being the common case in practice — needs real
  deployments to answer, not speculation.
- **Auto language detection accuracy.** How much bundled model size is
  worth it for higher detection accuracy vs. just requiring explicit
  `language` tagging for anything beyond a few high-resource languages?
- **Cross-index score normalization** (federated search,
  [07-client-api.md](07-client-api.md#federated-multi-index-search)) —
  min-max vs z-score vs learned normalization; needs empirical testing
  against real multi-corpus fixtures before picking a permanent default.

## Explicit non-features (revisit only with a concrete driver)

- Real-time index mutation from the browser (this is a read-only
  runtime by design).
- Server-side query logging/analytics baked into core (left as an
  observability hook, see [08-modern-features.md](08-modern-features.md#observability-hooks)).
- Built-in UI components beyond example code (kept as separate optional
  packages so core stays framework-agnostic).
