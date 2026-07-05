# Roadmap & Open Questions

## Status

Phases 0, 1, and 2 have working code in this repo (`packages/`,
`spec/`), not just design docs — see each phase below for what's
actually implemented vs. still pending. Phase 0 is now fully built,
including the realistically-shaped fixture corpus that was its last
pending item. Phase 3 is partially built (terms facets, range facet
*filtering*, and pins; hierarchical facets and aggregate range facet
results remain pending — see below). Phase 4 is partially built (a
second real LanguageProfile and true per-document-language corpus
partitioning; additional stemmers and the CJK bigram fallback remain
pending — see below). Phase 5 is mostly built (query-time synonym
expansion, plus SymSpell fuzzy matching and "did you mean"
suggestions; `multiWord` phrase-level synonyms remain pending — see
below). Phase 6 is partially built (a configuration testbed and a
bundle-size CI gate; streaming/highlighting/offline-Service-Worker/
accessibility/observability remain pending — see below). Phase 7+
remain design-only. The GitHub Pages showcase's first three stages
([`showcase/`](../showcase/)) are also built and actually
deployed — see below. Stage 3 remains blocked on Phase 8.

A code/docs review ([`REVIEW.md`](archive/REVIEW.md), response noted
inline there, archived now that its findings are all resolved) landed
alongside a batch of new draft specs
([spec-query-planner.md](spec-query-planner.md),
[spec-storage-api.md](spec-storage-api.md),
[spec-plugin-api.md](spec-plugin-api.md),
[spec-diagnostics.md](spec-diagnostics.md),
[spec-benchmarking.md](spec-benchmarking.md),
[spec-binary-format.md](spec-binary-format.md),
[21](21-architecture-principles.md)-[24](24-architecture-recommendations.md)) —
its findings (worker lifecycle, cache eviction, id validation, manifest
mutation, canonical JSON output, manifest/shard-origin validation, and
splitting docs/07 into implemented-vs-target) are all fixed with tests.

## Phased build plan

**Phase 0 — Spec & fixtures**
- ✅ Manifest/shard JSON Schema frozen as machine-checkable files:
  [`spec/schema/`](../spec/schema/) (manifest, term shard, facet shard,
  doc store shard, synonym shard, pins shard).
- ✅ Two independent reference generators proving the format needs no
  library buy-in — [`spec/examples/`](../spec/examples/)
  (Python + TypeScript), verified byte-for-byte structurally identical
  output and schema-valid against the files above.
- ✅ Realistically-shaped fixture corpus grounded in
  [14-reference-deployment-cms-2k.md](14-reference-deployment-cms-2k.md):
  [`@csf/fixtures`](../packages/fixtures) generates a deterministic,
  hand-written-prose (not lorem-ipsum) CMS-export-style corpus —
  marketing pages with authored pins, blog/docs-style pages with
  category/tag facets and boosts — parameterized by document count
  (fast counts for correctness tests, up to the full ~2,000, or beyond
  for Phase 7 macro-benchmarks, with a single option). Scoped to
  English + German only (the two LanguageProfiles that exist, Phase 4
  below); Japanese/Arabic remain unbuilt, so a fixture claiming to
  cover them would just crash `buildIndex`. Exercised end-to-end at
  realistic scale (hundreds of documents, not a handful) in both
  [`packages/indexer/test/cms-2k-fixture.test.ts`](../packages/indexer/test/cms-2k-fixture.test.ts)
  and
  [`packages/client/test/cms-2k-fixture.test.ts`](../packages/client/test/cms-2k-fixture.test.ts) —
  the existing tiny inline fixtures stay in place for fast, targeted
  per-feature unit tests; this is additive, a real-scale correctness
  pass alongside them, not a replacement.

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
- ✅ Terms facets: extraction (repeatable `csf-facet-<field>` meta tags,
  [15-cms-meta-tag-control.md](15-cms-meta-tag-control.md)), a
  shard-per-field format matching `spec/schema/facet-shard.schema.json`,
  `search()` options `filters` (OR within one field's array of values,
  AND across fields) and `facets` (contextual counts computed against
  every *other* active filter but not a field's own, so switching
  between values of the same facet shows real counts instead of the
  post-filter count for all of them).
- ✅ Range facet *filtering*: `csf-facet-range-<field>` extraction (one
  numeric value per doc, unlike terms facets' multi-value), a `type:
  "range"` shard storing every `(value, doc)` pair sorted ascending
  (`FacetShard.sorted`; `values` stays `{}` — precomputed buckets are a
  documented future optimization, not required for correctness at
  "small corpus" scale, [14-reference-deployment-cms-2k.md](14-reference-deployment-cms-2k.md#what-to-simplify-at-this-scale)),
  and `search(query, {filters: {field: {min?, max?}}})` resolving an
  arbitrary min/max via a scan of that array (linear, not
  binary-search — correct either way given the array's already
  sorted). Closes the gap the product-catalog showcase demo's
  bucketed-price terms facet was working around.
- ⬜ Aggregate range facet *results* (a histogram/bucket breakdown in
  `SearchResult.facets` for a range field, as opposed to filtering,
  which is built) and hierarchical facets — the shard format
  ([06-faceted-search.md](06-faceted-search.md)) supports `type:
  "hierarchy"` but has no builder/query-time implementation yet.
- ✅ Term-to-page pinning ([16-term-to-page-pinning.md](16-term-to-page-pinning.md)):
  extraction of `csf-pin`/`csf-pin-mode`/`csf-pin-priority`/
  `csf-pin-exclusive`, a pins shard keyed by the same normalized-phrase
  form as any indexed term, exact/contains matching at query time
  independent of whether the organic query itself matched anything,
  priority → doc-boost → build-order conflict resolution (with a build
  warning whenever more than one page pins the same phrase), exclusive
  mode (suppresses organic results entirely), and the facet-filter
  interaction (an active filter that excludes a pinned page hides that
  pin — grouped with facets for exactly this reason, since pin display
  has to respect active facet filters).
- ⬜ `facetValues()` (docs/07-client-api.md#facet-only-queries) — a
  filter-only browsing call with no free-text query — is not yet
  implemented; today `search()` requires at least one query term.
- All of the above verified with real end-to-end tests over real HTTP
  (`packages/indexer/test/{extract,build-index}.test.ts`,
  `packages/client/test/e2e.test.ts`), not just unit tests in isolation.

**Phase 4 — I18n**
- ✅ `LanguageProfile` abstraction with a second real profile
  ([`packages/analysis`](../packages/analysis)'s `german`, `Intl.Segmenter`
  locale `"de"`, `foldDiacritics: false` per
  [03-tokenization-i18n.md](03-tokenization-i18n.md#case-folding--diacritics)) —
  proves the abstraction actually varies per language, not just English
  reshaped.
- ✅ True per-language corpus partitioning: `buildIndex` analyzes each
  document under *its own* declared `<html lang>` (previously extracted
  but silently ignored — every document was forced through one
  language's profile regardless of what it declared), producing one
  term shard and one pins shard per language actually present, plus
  `docCount`/`avgFieldLength` computed independently per language — BM25
  needs these corpus-wide stats computed *within* the partition actually
  being searched, since mixing an English and a German doc's stats in
  one number would skew both languages' idf and length normalization.
  This required a manifest format change (`docCount`/`avgFieldLength`
  keyed by language — `spec/schema/manifest.schema.json`,
  `@csf/format`), which also fixed the two independent Phase 0 reference
  generators (`spec/examples/`) and re-verified they're still
  byte-for-byte identical and schema-valid after the change.
- ⬜ Additional stemmers (Snowball or otherwise) — both shipped profiles
  are still an identity pass, same status as Phase 1's English profile.
- ⬜ CJK/Thai bigram fallback, `Intl.Segmenter`-unsupported-locale
  handling — no non-Latin-script profile exists yet.
- All of the above verified with real end-to-end tests over real HTTP
  proving cross-language query isolation (a term never matches the
  wrong language's partition) and per-language BM25 stats, not just
  unit tests in isolation — 88 Vitest tests + 6 Playwright tests
  passing.

**Phase 5 — Synonyms & fuzzy**
- ✅ Query-time synonym expansion
  ([05-synonyms.md](05-synonyms.md)): author-supplied (not extracted
  from HTML — synonyms are corpus-vocabulary curation, not per-page
  metadata) equivalence classes and directional maps, normalized
  through each language's own analysis pipeline at build time (same
  `normalizePhrase()` pins already use), stored as one
  `synonyms/<lang>.json` shard per language. `search(query, {synonyms:
  true})` expands each non-prefix query term into its variants,
  contributing at a reduced score weight (default 0.5×, overridable via
  `synonymWeight`) so a literal match still outranks a synonym-only
  one. Off by default (opt-in per query, matching the option's original
  design in [07-client-api.md](07-client-api.md)).
- ⬜ `multiWord` phrase-level synonyms — the shard format
  (`spec/schema/synonym-shard.schema.json`) supports them, but they
  need a different, pre-tokenization phrase-matching path than the
  single-term lookups implemented so far, so neither the indexer nor
  the client produce/consume them yet.
- ✅ SymSpell fuzzy plugin, "did you mean"
  ([04-query-ranking-boosts.md](04-query-ranking-boosts.md#prefix--fuzzy-matching)):
  a precomputed deletion dictionary (`spec/schema/fuzzy-shard.schema.json`,
  one `fuzzy/<lang>.json` shard per language) built at index time via
  `buildIndex(sources, lang, { fuzzy: true })` — for every indexed term,
  every string reachable by deleting one code point maps back to the
  real term(s) that produced it. `search(query, { fuzzy: true })` looks
  up each non-prefix query term's own deletion variants against that
  dictionary to find distance-≤1 candidates cheaply, verifies true edit
  distance (Levenshtein) to reject deletion-variant collisions, and adds
  genuine matches at a reduced score weight (default 0.5×, raised to the
  power of edit distance, overridable via `fuzzyWeight`) — same
  literal-outranks-expansion pattern as synonyms. Off by default. When
  the query still returns zero hits, the same dictionary is reused
  (without the maxEdits cutoff, since a term worth suggesting has by
  definition already failed the strict threshold) to populate
  `didYouMean` with the nearest real term(s), including
  structurally-discoverable true-distance-2 matches (e.g. adjacent
  transpositions) that the strict matcher correctly excludes from
  scoring. Distance-2 dictionaries, length/language-dependent maxEdits,
  and the CJK bigram fallback remain design-only.
- Verified with real end-to-end tests over real HTTP: equivalence-class
  symmetry, directional one-way expansion, reduced-weight ranking,
  custom `synonymWeight`/`fuzzyWeight`, off-by-default behavior for both
  synonyms and fuzzy, strict-vs-suggestion distance cutoffs for fuzzy,
  and `didYouMean` presence/absence — not just unit tests in isolation.

**Phase 6 — Modern features polish**
- Streaming results, highlighting, offline/Service Worker plugin,
  accessibility pass, observability hooks.
- ✅ Bundle-size CI gate
  ([docs/08-modern-features.md#bundle-size-budget](08-modern-features.md#bundle-size-budget),
  [`packages/client/scripts/check-bundle-size.mjs`](../packages/client/scripts/check-bundle-size.mjs),
  run via `pnpm size` in CI): gzips the real `dist/index.js` and
  `dist/worker.js` entry points and fails the build past a 15 KB
  budget each — both sit around 1-1.5 KB today. Scoped to today's
  single-bundle reality (facets/pins/synonyms/fuzzy are all baked into
  one `@csf/client` bundle, not separate plugin entry points yet); the
  per-plugin budget table and tree-shaking verification in
  docs/08 remain the target design for whenever a plugin architecture
  actually ships, not what's checked now.
- ✅ Configuration testbed for regression testing
  ([10-testing-and-performance.md](10-testing-and-performance.md#1-correctness-tests),
  [`packages/client/test/config-testbed.test.ts`](../packages/client/test/config-testbed.test.ts)):
  a declared matrix of build/query configurations (default field
  boosts, a per-query title-boost override, fuzzy matching at a strict
  vs. lenient `fuzzyWeight`) run against a shared slice of the
  [`@csf/fixtures`](../packages/fixtures) CMS-2k corpus with a fixed
  query set, snapshotted per combination via Vitest — an intentional
  ranking change shows up as a reviewable snapshot diff across every
  configuration at once, the same way a UI screenshot test catches an
  unintended visual change. A synonyms variant isn't included yet: the
  fixture's prose has no deliberately paired synonym vocabulary (unlike
  showcase/gallery-synonyms-data.ts's couch/sofa pair), so a meaningful
  synonym configuration needs either new fixture content or its own
  corpus — left for a follow-up. BM25 `k1`/`b` variants and
  facets/filters on-or-off variants are likewise not in the matrix yet;
  the framework (one array of `{name, build, search}` entries) makes
  adding either a data change, not new test code.

**Phase 7 — Scale options**
- Binary tier codec (plus a Range-request-capable single-file postings
  variant), benchmarked against JSON at 10k/100k/1M synthetic corpus
  sizes to empirically set the size/density threshold where it's worth
  switching — see the investigation in
  [11-binary-vs-json-index.md](11-binary-vs-json-index.md) (the "should
  we, and when") and [spec-binary-format.md](spec-binary-format.md)
  (the physical layout, if/when the investigation says yes) — optional
  WASM scoring core, federated multi-index search, and the independent
  Python reference generator ([20-tech-stack.md](20-tech-stack.md#reference-index-generators-python-and-typescript),
  [10-testing-and-performance.md](10-testing-and-performance.md)) to
  prove the format is genuinely implementation-agnostic and not just
  agnostic in principle, alongside the TypeScript reference indexer
  already built in Phase 1. A query planner
  ([spec-query-planner.md](spec-query-planner.md)) and storage
  abstraction ([spec-storage-api.md](spec-storage-api.md)) are drafted
  extensibility groundwork for this phase's scale work, not yet built.

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
    on every push to `main` and is **live** at Pages' Project Pages URL
    for this repo. Getting there caught a second real deploy-workflow
    bug beyond the browser one above: the `deploy` job's official-
    template `environment: {name: github-pages}` block requires
    GitHub's deployment-Environments feature, which is a paid-plan
    restriction for *private* repositories — it made the job get
    rejected before a runner was ever assigned, rather than failing on
    an actual step. `actions/deploy-pages` doesn't require that binding
    to function, so it was removed.
  - ✅ Stage 2 (feature gallery) — all 4 demos built: the product
    catalog demo (64 synthetic products, terms facets,
    `csf-boost`-featured items, a `csf-pin` best-bet), the typo-
    tolerance demo (same corpus, a fuzzy on/off toggle), the synonym
    playground (6 docs with deliberately non-overlapping vocabulary, a
    symmetric equivalence class and a directional pair, expansion-only
    hits visibly badged), and the multi-language corpus demo (6
    parallel English/German articles — scoped to the two
    LanguageProfiles that actually exist per Phase 4 above, not the
    full English/German/Japanese/Arabic list originally proposed —
    demonstrating real per-document-language partitioning and
    diacritic-sensitive matching) are all live at `gallery/index.html`
    ([`showcase/build-gallery.ts`](../showcase/build-gallery.ts),
    [`showcase/build-gallery-synonyms.ts`](../showcase/build-gallery-synonyms.ts),
    [`showcase/build-gallery-i18n.ts`](../showcase/build-gallery-i18n.ts),
    verified end-to-end with real-browser Playwright tests). Each
    demo's manifest/shards are kept entirely separate from the docs
    site's search index and from each other (`build-search.ts` skips
    `dist/gallery/`), per
    [19-github-pages-showcase.md](19-github-pages-showcase.md#stage-2--feature-gallery-needs-phases-2-5)'s
    "not one shared mega corpus" design. `Intl.Segmenter` CJK handling,
    RTL rendering, and per-language stemming differences remain
    unbuilt (blocked on Phase 4 itself, not this stage).
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
