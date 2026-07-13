# Roadmap & Open Questions

## Status

Phases 0, 1, and 2 have working code in this repo (`packages/`,
`spec/`), not just design docs — see each phase below for what's
actually implemented vs. still pending. Phase 0 is now fully built,
including the realistically-shaped fixture corpus that was its last
pending item. Phase 3 is now fully built (terms facets, range facets
(both *filtering* and aggregate bucket *results*), hierarchical facets,
pins, and a filter-only `facetValues()` browsing call — see below).
Phase 4 is mostly built (a
second real LanguageProfile, true per-document-language corpus
partitioning, real stemmers for both English (classic Porter) and
German (Snowball), a CJK bigram-fallback `LanguageProfile` for
Chinese/Japanese, a Thai/Khmer/Lao trigram-fallback `LanguageProfile`
family, deterministic zero-bundled-model auto language detection (now
covering all of CJK and Thai/Khmer/Lao by script, plus English/German by
marker words) as an `<html lang>`-less fallback, and an `isRtlLanguage()`
primitive plus `SearchResult.language` so a consuming app can set
`dir="rtl"` without re-deriving either fact itself; the higher-precision
`Intl.Segmenter`-dictionary path for Chinese/Japanese (and, potentially,
Thai/Khmer/Lao) remains pending — see below). Phase
5 is now fully built (query-time synonym
expansion including `multiWord` phrase-level synonyms, SymSpell fuzzy
matching (distance-1 and opt-in distance-2) with a length-dependent
maxEdits cap, and "did you mean" suggestions — see below). Phase 6
is now fully built (a configuration testbed, a
bundle-size CI gate, result highlighting, observability hooks,
`options.signal` cancellation, `searchStream()` streaming results,
offline Service Worker caching, and an accessibility pass in the
showcase's own widgets). Phase 7 (scale options) has an opt-in binary
tier for term, fuzzy, and doc store shards, plus the benchmarking that
validated its design (facet/synonym/pins shards deliberately stay JSON —
see below for why). Phase 8
(vector & hybrid search) has its storage/similarity mechanics slice
built and tested — chunking, quantization, brute-force cosine
similarity, RRF hybrid fusion, an injectable query-embedding seam — plus
real local-model embedding integration via `@huggingface/transformers`
(`createTransformersEmbedder`/`createTransformersEmbedQuery`, both ends
kept to the same default model); a remote-API embedding option remains
unbuilt, see below. The GitHub Pages showcase's first three stages
([`showcase/`](../../../showcase/)) are also built and actually
deployed — see below. Stage 3 (a semantic search demo) is not yet built
in this repo: doing so means running the indexer with a real model at
build time, which needs network access to `huggingface.co` that this
development session's sandbox doesn't have — the mechanism itself is
ready to use the moment that access exists (a contributor's machine, or
a CI runner without this sandbox's restriction).

A code/docs review ([`REVIEW.md`](../REVIEW.md), response noted
inline there, archived now that its findings are all resolved) landed
alongside a batch of new draft specs
([../specs/query-planner.md](../specs/query-planner.md),
[../specs/storage-api.md](../specs/storage-api.md),
[../specs/plugin-api.md](../specs/plugin-api.md),
[../specs/diagnostics.md](../specs/diagnostics.md),
[../specs/benchmarking.md](../specs/benchmarking.md),
[../specs/binary-format.md](../specs/binary-format.md),
[21](../../concepts/architecture.md)-[24](./architecture-recommendations.md)) —
its findings (worker lifecycle, cache eviction, id validation, manifest
mutation, canonical JSON output, manifest/shard-origin validation, and
splitting docs/07 into implemented-vs-target) are all fixed with tests.

## Phased build plan

**Phase 0 — Spec & fixtures**
- ✅ Manifest/shard JSON Schema frozen as machine-checkable files:
  [`spec/schema/`](../../../spec/schema/) (manifest, term shard, facet shard,
  doc store shard, synonym shard, pins shard).
- ✅ Two independent reference generators proving the format needs no
  library buy-in — [`spec/examples/`](../../../spec/examples/)
  (Python + TypeScript), verified byte-for-byte structurally identical
  output and schema-valid against the files above.
- ✅ Cross-implementation conformance (the stronger claim
  [10-testing-and-performance.md](../../project/governance.md)'s
  "Cross-implementation conformance" bullet describes, beyond the
  structural-comparison bullet above):
  [`packages/client/test/cross-implementation-conformance.test.ts`](../../../packages/client/test/cross-implementation-conformance.test.ts)
  shells out to the Python reference generator as a subprocess, serves
  its output over real HTTP, and runs the same `SearchClient` query
  assertions against it as against a real `@ktjn/searchable-indexer`-built index of
  the same fixture — proving an independent, non-TypeScript, non-
  stemming producer's output actually loads and queries correctly
  through this project's own client, not just that the on-disk bytes
  look structurally similar. `spec/examples/documents.json`'s fixture
  text was tuned so its key query words stem to themselves under the
  real Porter stemmer, since `@ktjn/searchable-client`'s query analysis always
  stems regardless of which backend built the index being queried — a
  necessary accommodation for the two implementations' deliberately
  different tokenization (see `spec/examples/README.md`), not a
  weakening of the test.
- ✅ Realistically-shaped fixture corpus grounded in
  [../../guides/indexing.md](../../guides/indexing.md):
  [`@ktjn/searchable-fixtures`](../../../packages/fixtures) generates a deterministic,
  hand-written-prose (not lorem-ipsum) CMS-export-style corpus —
  marketing pages with authored pins, blog/docs-style pages with
  category/tag facets and boosts — parameterized by document count
  (fast counts for correctness tests, up to the full ~2,000, or beyond
  for Phase 7 macro-benchmarks, with a single option). Scoped to
  English + German only (the two LanguageProfiles that exist, Phase 4
  below); Japanese/Arabic remain unbuilt, so a fixture claiming to
  cover them would just crash `buildIndex`. Exercised end-to-end at
  realistic scale (hundreds of documents, not a handful) in both
  [`packages/indexer/test/cms-2k-fixture.test.ts`](../../../packages/indexer/test/cms-2k-fixture.test.ts)
  and
  [`packages/client/test/cms-2k-fixture.test.ts`](../../../packages/client/test/cms-2k-fixture.test.ts) —
  the existing tiny inline fixtures stay in place for fast, targeted
  per-feature unit tests; this is additive, a real-scale correctness
  pass alongside them, not a replacement.

**Phase 1 — Minimal viable engine (single language, JSON tier only)**
- ✅ Reference indexer — [`packages/indexer/`](../../../packages/indexer/):
  parses rendered HTML (title, `<main>`/body-minus-boilerplate,
  `csf-noindex`, `data-csf-body`/`data-csf-ignore`, canonical URL, meta
  description) per the `csf-*` meta-tag control surface
  ([../../reference/cms-meta-tags.md](../../reference/cms-meta-tags.md)), tokenizes
  via the shared [`packages/analysis/`](../../../packages/analysis/) package,
  emits a content-hashed manifest + single term shard + doc store shard
  (English only, unsharded — "small corpus mode").
- ✅ Browser runtime — [`packages/client/`](../../../packages/client/):
  manifest + shard fetch over plain HTTP (proven against a real, if
  tiny, HTTP server in tests, not just direct filesystem access),
  boolean AND query evaluation, full BM25F scoring (docs/04) with
  field boosts defaulting to 1.0 until Phase 2 sets real weights. No
  Worker yet (main thread), no fuzzy/synonyms/facets/pins plugins yet.
- ✅ Goal met: an end-to-end Vitest suite
  ([`packages/client/test/e2e.test.ts`](../../../packages/client/test/e2e.test.ts))
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
- ✅ Exact phrase queries (`"quoted phrase"`,
  [../../guides/ranking-and-boosts.md](../../guides/ranking-and-boosts.md)):
  `parse-query.ts`'s `parseQuery()` extracts every `"..."` segment from
  the raw query string into its own clause before the existing
  space-separated term parsing runs on what's left; `search()` resolves
  a phrase clause by exact dictionary lookup of every constituent word
  (no prefix/synonym/fuzzy expansion inside a phrase, out of scope for
  this first slice) plus a real position-adjacency check
  (`hasConsecutivePositions()`) against the stored per-field token
  positions ([02-index-format.md](../../concepts/index-format.md#term-shard-inverted-index)) —
  a document where the words are present but in the wrong order,
  non-adjacent, or split across different fields correctly fails the
  clause even though it would satisfy a bare AND of the same words.
  Proximity/slop (relaxing "consecutive" to "within N positions")
  remains design-only. Verified with real end-to-end tests over real
  HTTP: adjacent-in-order match, reversed order rejected, same-field
  non-adjacent rejected, split-across-fields rejected, AND-ing against
  a plain term clause, a single-quoted word behaving identically to an
  unquoted term, a missing constituent word both failing the query and
  feeding "did you mean," and highlighting each phrase word in the
  matched result.
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
  [`packages/client/e2e-browser/worker.spec.ts`](../../../packages/client/e2e-browser/worker.spec.ts).
- All of the above verified with real end-to-end tests (not just unit
  tests) proving the ranking/boost/worker effect actually changes what
  the real client returns, not just that the scoring function's math
  looks right in isolation or the protocol's shape typechecks. 51
  Vitest tests + 3 real-browser Playwright tests passing.

Phase 2 is now fully implemented.

**Phase 3 — Facets & curated pins**
- ✅ Terms facets: extraction (repeatable `csf-facet-<field>` meta tags,
  [../../reference/cms-meta-tags.md](../../reference/cms-meta-tags.md)), a
  shard-per-field format matching `spec/schema/facet-shard.schema.json`,
  `search()` options `filters` (OR within one field's array of values,
  AND across fields) and `facets` (contextual counts computed against
  every *other* active filter but not a field's own, so switching
  between values of the same facet shows real counts instead of the
  post-filter count for all of them).
- ✅ Range facet *filtering*: `csf-facet-range-<field>` extraction (one
  numeric value per doc, unlike terms facets' multi-value), a `type:
  "range"` shard storing every `(value, doc)` pair sorted ascending
  (`FacetShard.sorted`), and `search(query, {filters: {field: {min?,
  max?}}})` resolving an arbitrary min/max via a scan of that array
  (linear, not binary-search — correct either way given the array's
  already sorted). Closes the gap the product-catalog showcase demo's
  bucketed-price terms facet was working around.
- ✅ Aggregate range facet *results* (a histogram/bucket breakdown in
  `SearchResult.facets`/`facetValues()`, as opposed to filtering,
  which was built separately above):
  `computeRangeFacetBucketsEqualWidth()` in
  [`packages/indexer/src/build-index.ts`](../../../packages/indexer/src/build-index.ts)
  computes equal-width buckets spanning the corpus's observed
  `[min, max]` once every document has been processed, populating
  `FacetShard.values` with the same `{count, docs}` shape terms facets
  already use, keyed by a label like `"10-20"` or `"80+"` for the
  open-ended last bucket (a single distinct value collapses to one
  bucket instead of N degenerate zero-width ones). That shape reuse is
  the entire feature: `packages/client/src/search.ts`'s `search()` and
  `facetValues()` already iterate `shard.values` generically regardless
  of facet type, so **no client-side code changed at all** to surface
  these — only the indexer needed new code. Bucket count defaults to 5
  but is now an author-configurable build option too,
  `BuildIndexOptions.rangeFacetBuckets: Record<field, number>` — a
  non-positive-integer count throws at build time. Author-configurable
  bucket *boundaries* are built too: passing a `number[]` of
  strictly-ascending cut points instead of a count (e.g. `{ price:
  [25, 50, 100, 250] }`) switches to
  `computeRangeFacetBucketsExplicit()`, producing fixed brackets
  (`"<25"`, `"25-50"`, ..., `"250+"`) independent of the corpus's
  observed `[min, max]`, for real-world tiers an equal-width split
  would never land on — deliberately with no "single distinct value
  collapses" special case, since a fixed bucket is meaningful
  regardless of how many distinct values exist. An empty,
  non-finite, or non-strictly-ascending boundaries array throws at
  build time, same as an invalid count.
- ✅ Hierarchical facets
  ([../../guides/facets.md#facet-types](../../guides/facets.md#facet-types),
  [`packages/indexer/src/build-index.ts`](../../../packages/indexer/src/build-index.ts)):
  a build-time option, `buildIndex(sources, lang, {
  hierarchicalFacets: { category: { separator?: ">" } } })`, marks a
  `csf-facet-<field>` field as path-structured — each authored value
  (e.g. `"electronics>audio>headphones"`) expands into every ancestor
  prefix (`"electronics"`, `"electronics>audio"`,
  `"electronics>audio>headphones"`), each indexed as its own
  addressable `{count, docs}` entry, the exact shape terms facets
  already use — the same "reuse the existing generic shape, zero
  client-side code changes" design as the aggregate range facet
  results bullet above, since `search()`/`facetValues()` already
  iterate `shard.values` without caring what facet type produced them.
  A doc that declares two sibling paths sharing an ancestor is still
  counted once at that ancestor, not once per sibling (a `Set` of
  expanded paths per document, not a raw per-value loop). The one
  genuinely new client-side surface is `FacetResult.separator`,
  populated only for a hierarchy-type field so a consumer can split a
  path into segments without hardcoding a delimiter — reconstructing
  the tree shape itself from those flat, separator-delimited entries
  is left to the consumer, per the original design doc. Not built:
  per-branch lazy shard fetching (every level still lives in one
  shard, same as an ordinary terms facet) and author-configurable
  min/max depth.
- ✅ Term-to-page pinning ([../../guides/pinning.md](../../guides/pinning.md)):
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
- ✅ `facetValues()` (docs/07-client-api.md#facet-only-queries) — a
  filter-only browsing call with no free-text query, for rendering a
  facet panel (e.g. a category landing page) before a visitor has typed
  anything. Reuses the same contextual-count convention as `search()`'s
  `facets` option (every *other* active filter applied, not the field's
  own) and the same facet-shard fetch/union-doc-ids logic, refactored to
  module level in `packages/client/src/search.ts` so `search()` and
  `facetValues()` can't drift on that logic independently. When no
  other filter is active, counts come directly from the facet shard's
  precomputed build-time `count` rather than re-deriving it from
  `entry.docs.length` — a small optimization justified by the build-time
  invariant that the two are always incremented together
  (`packages/indexer/src/build-index.ts`'s `addFacetValues`). A
  range-type field returns aggregate bucket values, and a
  hierarchy-type field returns `separator` alongside its flat
  per-level `values`, the same way `search()`'s `facets` option does
  for both (see the range/hierarchical facets bullets above).
- All of the above verified with real end-to-end tests over real HTTP
  (`packages/indexer/test/{extract,build-index}.test.ts`,
  `packages/client/test/e2e.test.ts`), not just unit tests in isolation.

**Phase 4 — I18n**
- ✅ `LanguageProfile` abstraction with a second real profile
  ([`packages/analysis`](../../../packages/analysis)'s `german`, `Intl.Segmenter`
  locale `"de"`, `foldDiacritics: false` per
  [03-tokenization-i18n.md](../../guides/internationalization.md)) —
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
  `@ktjn/searchable-format`), which also fixed the two independent Phase 0 reference
  generators (`spec/examples/`) and re-verified they're still
  byte-for-byte identical and schema-valid after the change.
- ✅ Real English stemmer
  ([../../guides/internationalization.md#stemming](../../guides/internationalization.md#stemming),
  [`packages/analysis/src/stemmer-en.ts`](../../../packages/analysis/src/stemmer-en.ts)):
  the classic Porter algorithm (1980) — deliberately the original, not
  the later incompatible Snowball-framework "Porter2" English stemmer —
  verified against the standard 23,531-word public reference vocabulary
  with zero mismatches (`packages/analysis/test/stemmer-en.test.ts`),
  not just a hand-picked sample. Wired into `english.stem`
  (`packages/analysis/src/language-profile.ts`). Required threading a
  second, *unstemmed* "literal" surface form through `Token`/`QueryTerm`
  alongside the stemmed one (`packages/analysis/src/analyze.ts`,
  `packages/client/src/parse-query.ts`), since result highlighting
  matches literal stored text and a stemmed query term wouldn't
  `\b`-match a document's actual surface spelling.
- ✅ Real German stemmer
  ([../../guides/internationalization.md#stemming](../../guides/internationalization.md#stemming),
  [`packages/analysis/src/stemmer-de.ts`](../../../packages/analysis/src/stemmer-de.ts)):
  the Snowball German algorithm — a from-scratch port, not a variant of
  the English one, since German has no pre-Snowball "classic" stemmer
  to implement instead — verified against the standard 35,053-word
  public reference vocabulary with zero mismatches
  (`packages/analysis/test/stemmer-de.test.ts`). Region-based (`R1`/`R2`)
  rather than measure-based, with its own longest-match-wins suffix
  resolution (the same control-flow pattern already fixed for English's
  `applyRules()`, since several German suffix alternatives are literal
  suffixes of each other too, e.g. `"es"` of `"s"`) and a
  prelude/postlude pair that folds `ß`/`ae`/`oe`/`ue` going in and any
  *remaining* umlaut back to a plain vowel coming back out. That last
  fold means `schon`/`schön` (previously kept distinct only because
  German had no real stemmer at all) now both stem to `"schon"`, an
  accepted tradeoff of a real, spec-conforming stemmer over the earlier
  identity passthrough — see
  [../../guides/internationalization.md](../../guides/internationalization.md).
  Wired into `german.stem`; the multi-language corpus showcase demo and
  its test were updated to match
  ([19-github-pages-showcase.md](./github-pages-showcase.md#stage-2--feature-gallery-needs-phases-2-5)).
- ✅ CJK bigram-fallback segmentation
  ([../../guides/internationalization.md#segmentation](../../guides/internationalization.md#segmentation),
  [`packages/analysis/src/segment-cjk.ts`](../../../packages/analysis/src/segment-cjk.ts)):
  two new `LanguageProfile`s, `chinese` (`"zh"`) and `japanese`
  (`"ja"`), both using the same bigram segmenter — a run of consecutive
  Han/hiragana/katakana characters is split into overlapping
  2-character windows (`"自然語言"` -> `"自然"`, `"然語"`, `"語言"`),
  guaranteeing correct substring matching in any environment without a
  bundled word-boundary dictionary, at the cost of some index size and
  relevance precision versus true dictionary segmentation. A lone
  single-character CJK run is indexed as that one character rather
  than dropped, so single-character words stay searchable. A run of
  non-CJK characters (Latin words, digits, punctuation, whitespace —
  common in real CJK text, e.g. product codes or English loanwords) is
  segmented normally via `Intl.Segmenter`, exactly like the
  space-delimited-language profiles. `stem` is the identity function
  for both, matching the documented "no good affix-stripping stemmer"
  no-op rule. Deliberately built as the *only* segmentation strategy
  for these two profiles rather than gated behind detecting "incomplete
  `Intl.Segmenter` support" (unreliable to detect portably across the
  arbitrary browsers/Node versions this runtime targets) — the
  higher-precision `Intl.Segmenter("zh"|"ja")` dictionary-based path
  the original design called for remains a documented future upgrade,
  not built here.
- ✅ Thai/Khmer/Lao trigram-fallback segmentation
  ([../../guides/internationalization.md#segmentation](../../guides/internationalization.md#segmentation),
  [`packages/analysis/src/segment-sea.ts`](../../../packages/analysis/src/segment-sea.ts)):
  three new `LanguageProfile`s, `thai` (`"th"`), `khmer` (`"km"`), and
  `lao` (`"lo"`), all using the same trigram segmenter over their
  respective script ranges (Thai U+0E00-0E7F, Lao U+0E80-0EFF, Khmer
  U+1780-17FF) — the same n-gram robustness-net strategy as the CJK
  bigram profiles above, but at width 3 rather than 2, since a single
  codepoint in these scripts (often just one letter or one combining
  vowel/tone mark) is finer-grained than a Han character or kana
  syllable. The run-scanning/windowing mechanics are shared with the CJK
  profiles via a new `packages/analysis/src/segment-ngram.ts`
  (`segmentByScriptNgram(text, isInScript, n)`), refactored out of
  `segment-cjk.ts` without changing its output (verified: its existing
  tests pass unchanged). `stem` is the identity function, same reasoning
  as CJK. `getRegisteredLanguageCodes()`-driven candidate lists meant
  `extract.ts`'s `detectLanguage()` fallback and every other
  registry-consuming call site picked these up automatically, with zero
  code changes needed there.
- ✅ Auto language detection + an RTL primitive
  ([03-tokenization-i18n.md](../../guides/internationalization.md),
  `packages/analysis/src/detect-language.ts`'s `detectLanguage()`,
  `packages/analysis/src/is-rtl.ts`'s `isRtlLanguage()`): a
  deterministic, zero-bundled-model fallback wired into
  `extractDocument()` for pages with no `<html lang>` — script-range
  detection for CJK and, as of the Thai/Khmer/Lao slice above,
  Thai/Lao/Khmer too (all unambiguous, each its own non-overlapping
  Unicode block), small curated function-word lists for the two
  Latin-script profiles that exist (English, German), deliberately
  independent of `LanguageProfile.stopwords` (still empty everywhere,
  unrelated). An explicit `<html lang>` always wins; a low-confidence
  detection still falls back to `defaultLanguage`, exactly the prior
  behavior. `isRtlLanguage(code)` (re-exported from `@ktjn/searchable-client`) plus
  the new `SearchResult.language` field (below) give a consuming app
  the two facts it needs to set `dir="rtl"` on a results container
  without re-deriving either itself — RTL *layout* stays a
  consuming-app concern
  ([08-modern-features.md](../../concepts/architecture.md)), no
  Arabic/Hebrew `LanguageProfile` is built (a separate, much larger
  undertaking — real stemming/segmentation for those scripts), and no
  future `@csf/react` package exists yet to consume any of this — this
  slice is the one small, stable, deterministic primitive the core
  library is actually positioned to hand over today.
- ✅ `SearchResult.language` (`packages/client/src/search.ts`): the
  resolved language a result set was actually computed against
  (`options.language ?? manifest.defaultLanguage`) — every hit in one
  result comes from that single language's partition, so this is one
  value per result, not per-hit. Populated identically across
  `mode: "lexical"` (default), `"vector"`, and `"hybrid"` — see
  [../../guides/vector-search.md](../../guides/vector-search.md).
- All of the above verified with real end-to-end tests over real HTTP
  proving cross-language query isolation (a term never matches the
  wrong language's partition) and per-language BM25 stats, not just
  unit tests in isolation — 88 Vitest tests + 6 Playwright tests
  passing.

**Phase 5 — Synonyms & fuzzy**
- ✅ Query-time synonym expansion
  ([../../guides/synonyms.md](../../guides/synonyms.md)): author-supplied (not extracted
  from HTML — synonyms are corpus-vocabulary curation, not per-page
  metadata) equivalence classes and directional maps, normalized
  through each language's own analysis pipeline at build time (same
  `normalizePhrase()` pins already use), stored as one
  `synonyms/<lang>.json` shard per language. `search(query, {synonyms:
  true})` expands each non-prefix query term into its variants,
  contributing at a reduced score weight (default 0.5×, overridable via
  `synonymWeight`) so a literal match still outranks a synonym-only
  one. Off by default (opt-in per query, matching the option's original
  design in [../../reference/client-api.md](../../reference/client-api.md)).
- ✅ `multiWord` phrase-level synonyms
  ([05-synonyms.md](../../guides/synonyms.md#synonym-file-format)): built on top
  of Phase 2's exact-phrase-query work above, which supplied the
  genuine position-adjacency matching path this needed (the
  originally-cited blocker — "no phrase-matching path exists at
  all" — is what got resolved there). `SynonymShard.multiWord?:
  string[][]` holds symmetric phrase equivalence groups (e.g. `[["new
  york", "nyc", "big apple"]]`), each phrase normalized as a whole unit
  via the same `normalizePhrase()` call equivalences/directional
  already use, so it matches whatever a query-time `"quoted phrase"`
  clause's own analyzed words produce. `search(query, { synonyms: true
  })` resolves a phrase clause as one or more "attempts" — the literal
  phrase (weight 1.0) plus every other phrase in its `multiWord` group
  (`synonymWeight`, same reduced-weight convention as single-word
  synonyms) — each independently verified via real position-adjacency,
  not a text-substitution shortcut; a doc that only matched through a
  lower-weight variant is scored using that variant's own (postings-filtered)
  contribution, not the literal phrase's, so a lower-weight match can't
  smuggle in full-weight credit. An attempt with a word missing from
  the dictionary is silently skipped (same tolerance a missing
  single-word synonym variant gets); only the literal phrase's own
  missing words feed "did you mean." `writeIndex()`'s
  language-has-synonym-data filter was fixed alongside this to also
  check `multiWord` (previously a language with *only* `multiWord`
  data would have been silently skipped and never gotten a synonym
  shard written at all). Verified with real end-to-end tests over real
  HTTP: default (no cross-match), full expansion, literal-outranks-expanded
  ordering, a custom `synonymWeight`, a single quoted word participating
  in a `multiWord` group, highlighting only the literal phrase's words,
  and a variant still matching even when the literal phrase's own words
  don't exist anywhere in the corpus.
- ✅ SymSpell fuzzy plugin, "did you mean"
  ([04-query-ranking-boosts.md](../../guides/ranking-and-boosts.md)):
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
  scoring.
- ✅ Distance-2 dictionaries and a length-dependent maxEdits cap
  ([../../guides/ranking-and-boosts.md](../../guides/ranking-and-boosts.md)):
  `buildIndex(sources, lang, { fuzzy: true, fuzzyMaxEdits: 2 })`
  generates every deletion-of-a-deletion variant too, not just direct
  single deletions — a genuine breadth-first expansion
  (`generateDeletes()` in `packages/indexer/src/build-index.ts`), so a
  real distance-2 typo is guaranteed findable rather than only
  discoverable by the distance-1 dictionary's occasional
  symmetric-delete coincidences. Guaranteeing this requires the
  *query* side to generate deletions exactly as deep as the shard was
  built (`packages/client/src/search.ts` reads `FuzzyShard.maxEdits`
  back off the fetched shard) — a substitution-type distance-2 pair
  (as opposed to a pure two-character deletion) only meets in the
  middle if both the indexed term and the query term reach the same
  deletion depth. Separately, a query term of 3 code points or fewer
  is capped at accepting only distance-1 matches for actual query
  expansion regardless of what the dictionary supports
  (`effectiveMaxEdits()`) — this is also the answer to fuzzy
  matching's interaction with the CJK bigram profiles
  ([../../guides/internationalization.md#segmentation](../../guides/internationalization.md#segmentation)):
  bigram terms are always 1-2 characters, so the length cap already
  restricts them to distance-1 fuzzy matching with no CJK-specific
  code needed. "Did you mean" deliberately ignores this cap (same
  reasoning as it already ignores the dictionary's own maxEdits
  cutoff). The originally-planned *different* CJK mechanism — fuzzy
  tolerance "for free" via partial bigram overlap instead of edit
  distance — remains unbuilt; it would need `search()`'s
  boolean-AND-across-terms matching relaxed to a minimum-overlap-ratio
  scheme, a separate, larger change to the query engine itself.
- Verified with real end-to-end tests over real HTTP: equivalence-class
  symmetry, directional one-way expansion, reduced-weight ranking,
  custom `synonymWeight`/`fuzzyWeight`, off-by-default behavior for both
  synonyms and fuzzy, strict-vs-suggestion distance cutoffs for fuzzy,
  and `didYouMean` presence/absence — not just unit tests in isolation.

**Phase 6 — Modern features polish**
- ✅ Cancellation
  ([docs/../../concepts/architecture.md](../../concepts/architecture.md),
  [`packages/client/src/client.ts`](../../../packages/client/src/client.ts)):
  `search()`/`facetValues()` accept `options.signal: AbortSignal` — an
  already-aborted signal rejects immediately, before any fetch/worker
  round trip; a signal that fires mid-flight rejects the call with a
  `DOMException` named `"AbortError"` as soon as it does, giving a
  keystroke-driven instant-search box a way to guarantee a superseded
  query's promise never resolves and overwrites the latest results,
  even without an app-level debounce. Deliberately does not cancel the
  underlying shard fetch/worker computation itself — only the caller's
  wait on it — since `ShardCache` memoizes fetches across concurrent
  callers and aborting a fetch a different, still-active query depends
  on would be wrong; the aborted call's own fetch still completes in
  the background and warms the cache for the *next* query. Verified
  with real end-to-end tests over real HTTP plus a real-browser
  Playwright test proving identical behavior whether the aborted query
  executed inside a Worker or on the main thread.
- ✅ Streaming/incremental results
  ([docs/../../reference/client-api.md#streamingincremental-results](../../reference/client-api.md#streamingincremental-results),
  [`packages/client/src/search.ts`](../../../packages/client/src/search.ts),
  [`packages/client/src/client.ts`](../../../packages/client/src/client.ts)):
  `SearchClient.searchStream(query, { onPartial, ... })` resolves to the
  same final `SearchResult` `search()` would, but — only when the
  caller opted into `synonyms` and/or `fuzzy` — first invokes
  `onPartial` with the fast literal/prefix-only pass, so a
  keystroke-driven UI can render exact matches before the (potentially
  slower) expanded pass lands. Implemented by calling `search()` itself
  up to twice rather than restructuring its clause-scoring loop into a
  genuinely shared two-phase pass, as originally envisioned above:
  `ShardCache` already memoizes the term-shard fetches both passes
  need, so the only repeated work is the cheap, in-memory
  clause/scoring loop, negligible next to the correctness risk of
  threading a partial-emission callback through that loop's
  single-pass control flow. Works in both direct-execution and
  real-Worker mode — the worker protocol gained a `"partial"` response
  message, sent before the final `"result"` message for the same
  request id, that doesn't settle the pending request. `onPartial` is
  guarded to never fire once `options.signal` has already aborted,
  matching `search()`'s "nothing is delivered to an aborted caller"
  rule from the cancellation primitive above, even though (same as
  `search()`) an abort only cancels the caller's *wait*, not the
  underlying passes still running in the background. Verified with real
  end-to-end tests over real HTTP plus real-browser Playwright tests
  proving identical partial/final events whether `searchStream()`
  executed inside a Worker or on the main thread.
- ✅ Offline/Service Worker caching
  ([docs/../../concepts/architecture.md](../../concepts/architecture.md),
  [docs/../../reference/client-api.md](../../reference/client-api.md),
  [`packages/client/src/sw.ts`](../../../packages/client/src/sw.ts),
  [`packages/client/src/offline.ts`](../../../packages/client/src/offline.ts)):
  `registerOfflineCaching(swUrl, indexUrl, options)` registers a
  Service Worker (a separate Vite library entry, `dist/sw.js`, same
  pattern as `worker.js`) that precaches the manifest plus every shard
  file on `install` — or, via `options.languages`, only the selected
  languages' term/pins/synonym/fuzzy shards (facet and doc-store shards
  aren't per-language, so they're always cached in full) — then serves
  matching requests `"cache-first"` (default) or
  `"stale-while-revalidate"` (`options.mode`) on every subsequent load,
  including fully offline, since the index is 100% static files to
  begin with. Built as a standalone opt-in module rather than gated
  behind the generic plugin system in
  [../specs/plugin-architecture.md](../specs/plugin-architecture.md) (still
  design-only, no code yet) — building a whole plugin contract as a
  prerequisite for one caching feature would have been the wrong
  order. Only requests under the manifest's own directory are ever
  intercepted, so this Service Worker's presence never adds latency to
  unrelated page traffic. One flat, unversioned cache
  (`"csf-offline"`) rather than one keyed by `manifest.buildId`: since
  every shard file is already content-hashed
  (docs/02-index-format.md#versioning--cache-strategy), a new build's
  shard URLs simply differ from the old build's, and the only
  non-hashed URL (the manifest itself) is naturally overwritten by
  `cache.put()` on every install — old shard entries become
  unreferenced dead weight, never served incorrectly. Pruning that dead
  weight remains a known future improvement, not attempted here.
  Verified with real-browser Playwright tests: full precache plus
  working fully offline (`context.setOffline(true)`),
  `options.languages` actually restricting which term shard gets
  cached, and `"stale-while-revalidate"` mode also serving successfully
  while offline.
- ✅ Observability hooks, first slice
  ([docs/../../concepts/architecture.md](../../concepts/architecture.md),
  [`packages/client/src/client.ts`](../../../packages/client/src/client.ts)):
  `SearchClient.on("query" | "result", listener)` exposes the two
  lifecycle events named in the design doc — `"query"` fires
  synchronously the moment `search()` is called (before any
  fetch/worker round trip), `"result"` fires once it resolves — so a
  consumer wires up its own analytics without this library phoning
  home. `on()` returns an unsubscribe function; a throwing listener
  can't break the `search()` call it's observing. Deliberately scoped
  to `search()` only (not `facetValues()`, which has no query text for
  a `"query"` event to carry) and to just these two event types —
  finer-grained phase events (shards fetched, scoring complete) and a
  dedicated zero-results event remain unbuilt, since a consumer already
  gets that by inspecting `result.totalHits` inside its own `"result"`
  listener. Verified with real end-to-end tests over real HTTP,
  including a real-browser Playwright test proving events fire
  identically whether the query executed inside a Worker or on the
  main thread.
- ✅ Result highlighting, first slice
  ([docs/../../concepts/architecture.md](../../concepts/architecture.md),
  [`packages/client/src/highlight.ts`](../../../packages/client/src/highlight.ts)):
  `search(query, { highlight: true })` populates `Hit.highlights` with
  match/non-match spans per stored field, matching the literal query
  terms typed (prefix-aware). Deliberately scoped narrower than the
  target design: no synonym/fuzzy-expansion-variant highlighting (only
  literal typed terms), no best-scoring-window snippet selection over
  full body text (the doc store doesn't retain full body text to
  select a window from), and no raw-HTML convenience string (spans
  only) — see the doc's Status note for why each is deferred rather
  than a redesign.
- ✅ Bundle-size CI gate
  ([docs/../../concepts/architecture.md](../../concepts/architecture.md),
  [`packages/client/scripts/check-bundle-size.mjs`](../../../packages/client/scripts/check-bundle-size.mjs),
  run via `pnpm size` in CI): gzips the real `dist/index.js` and
  `dist/worker.js` entry points and fails the build past a 15 KB
  budget each — both sit around 1-1.5 KB today. Scoped to today's
  single-bundle reality (facets/pins/synonyms/fuzzy are all baked into
  one `@ktjn/searchable-client` bundle, not separate plugin entry points yet); the
  per-plugin budget table and tree-shaking verification in
  docs/08 remain the target design for whenever a plugin architecture
  actually ships, not what's checked now.
- ✅ Configuration testbed for regression testing
  ([10-testing-and-performance.md](../../project/governance.md),
  [`packages/client/test/config-testbed.test.ts`](../../../packages/client/test/config-testbed.test.ts)):
  a declared matrix of build/query configurations (default field
  boosts, a per-query title-boost override, fuzzy matching at a strict
  vs. lenient `fuzzyWeight`) run against a shared slice of the
  [`@ktjn/searchable-fixtures`](../../../packages/fixtures) CMS-2k corpus with a fixed
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
- ✅ Accessibility pass, first slice
  ([docs/../../concepts/architecture.md](../../concepts/architecture.md),
  [`showcase/src/search-widget.ts`](../../../showcase/src/search-widget.ts),
  [`showcase/src/gallery-widget.ts`](../../../showcase/src/gallery-widget.ts)):
  the showcase's own widgets demonstrate the documented `aria-live`
  pattern as consuming-app code — the docs search box gets
  `aria-expanded`/`aria-controls` on its `<input>` plus a
  visually-hidden `role="status" aria-live="polite"` announcer that
  reports result counts and no-results messages on every keystroke; the
  feature-gallery widget's already-visible result-count paragraph is
  promoted to the same kind of live region in place, rather than adding
  a redundant hidden announcer next to visible text. Verified with two
  real-browser Playwright tests. Scoped narrower than the target
  design: no full WAI-ARIA combobox/listbox pattern (roving
  `aria-activedescendant`, arrow-key navigation) and no RTL layout —
  both deferred to the future `@csf/react` package, since these are
  plain-DOM demo widgets, not a reusable accessible-by-default
  component library.

**Phase 7 — Scale options**
- ✅ Found and fixed a real O(n²) `buildIndex()` performance bug while
  establishing the JSON-tier scaling baseline this phase's investigation
  needs ([../investigations/binary-vs-json-index.md](../investigations/binary-vs-json-index.md)):
  `addPostings()` (`packages/indexer/src/build-index.ts`) looked up a
  term's existing posting for a document via
  `entry.postings.find((p) => p.doc === docId)` — an O(current
  document-frequency) scan repeated for every (term, doc, field) triple
  indexed, making the whole build effectively O(n²) in corpus size once
  a term's posting list grew large (measured before the fix: ~1.1s at
  1k docs, ~31s at 10k, an unsustainable curve for the "generate a
  1M-doc synthetic corpus for benchmarking" work this phase actually
  needs). Fixed with a per-language `Map<term, Map<docId, Posting>>`
  index maintained alongside each language's `TermShard`, giving O(1)
  lookup without changing `entry.postings`' insertion order or any
  output shape — confirmed behavior-identical by the full existing test
  suite passing unchanged. After the fix: ~1.1s at 1k docs, ~11s at 10k,
  ~153s at 100k — roughly linear (mildly super-linear, consistent with
  GC/allocation overhead at scale, not a remaining algorithmic
  blowup). A dedicated regression test
  (`packages/indexer/test/cms-2k-fixture.test.ts`) guards against this
  bug class recurring: a hand-rolled worst-case corpus (every document
  shares the same small vocabulary, maximizing every term's document
  frequency) asserts an 8x corpus-size jump stays under a 12x time
  increase — true linear scaling lands near 8x, the fixed bug measured
  ~22x on this exact corpus shape.
- ✅ JSON-tier scaling benchmark
  (`packages/indexer/bench/json-tier-scaling.mjs`, run via `pnpm bench`):
  builds real synthetic corpora (`@ktjn/searchable-fixtures`'s `generateCms2kCorpus()`)
  at 1k/10k/100k documents through the actual `buildIndex()`/`writeIndex()`
  pipeline and measures build/write time, on-disk shard sizes (raw and
  gzip), and `JSON.parse` time on the shard(s) a query would actually
  fetch. Capped at 100k, not 1M — the 100k build alone uses several GB of
  resident memory in this reference (in-memory, non-streaming) indexer,
  and 1M would extrapolate past the ~15GB available on a typical CI/dev
  machine; that ceiling is itself a finding (see
  [../investigations/binary-vs-json-index.md](../investigations/binary-vs-json-index.md)), not
  something to push through by brute force. This benchmark's first run
  surfaced the headline finding below (`writeIndex()` had no real prefix
  sharding), which is now fixed; the table compares the two.
- ✅ Real per-first-character-prefix term sharding
  (`packages/indexer/src/write-index.ts`'s `shardTermsByPrefix()`,
  `packages/client/src/search.ts`'s `shardEntriesForQuery()`): the
  benchmark above initially found that `writeIndex()` emitted exactly
  *one* term shard per language (`terms/<lang>/all.json`, `prefix:
  "all"`), not the per-first-character-prefix sharding
  [02-index-format.md](../../concepts/index-format.md#term-shard-inverted-index)
  documents as the design — a known, already-recorded Phase 1 "small
  corpus mode" simplification, never revisited (Phase 1's bullet above),
  not a regression — with the measured consequence that every query
  fetched and parsed the *entire* per-language vocabulary regardless of
  the term searched, so per-query bytes/parse time grew with corpus size
  instead of staying flat. Fixed on both ends:
  - **Indexer**: `writeIndex()` now splits each language's term shard
    into one-character-prefix buckets by default, auto-widening any
    bucket whose gzip size still exceeds a configurable budget (default
    50KB, `docs/02`'s own number) one prefix character at a time,
    recursively, until it fits, its terms stop separating further (every
    remaining term already shares that whole prefix), or an 8-character
    safety cap is hit — the latter two log a warning and ship the
    oversized shard as-is rather than fail the build, since a single
    term whose own posting list alone exceeds the budget (a real,
    observed case at 100k docs: `docs/02`'s per-prefix sharding narrows
    *which terms* are in a shard, but can't shrink one term's own
    already-huge posting list) is exactly the kind of density the binary
    tier ([../investigations/binary-vs-json-index.md](../investigations/binary-vs-json-index.md)) is
    for, not further JSON prefix recursion. A `{ shardByPrefix: false }`
    option (docs/14's already-recommended small-corpus-mode) opts back
    into the single-shard-per-language behavior when a corpus is small
    enough that sharding solves a problem that doesn't exist yet.
  - **Client**: `search()` no longer fetches every term shard for the
    query's language — it computes the exact set of terms a query needs
    (literal terms, plus every synonym/fuzzy candidate variant, plus
    phrase words, resolved *before* any term shard is fetched) and every
    prefix a `term*` prefix-query clause could overlap, then fetches
    only the shard(s) actually covering that set. Proven with new
    real-HTTP e2e tests
    (`packages/client/test/e2e.test.ts`'s "prefix-sharded term shard
    fetching" suite) asserting the shards requested from the static
    server for a query never include an unrelated-prefix shard, not just
    that results are still correct.

  Measured before/after (en, per-query worst-case fetch = the *entire*
  vocabulary before, the *largest single shard* after — the honest
  worst case any one query could actually trigger):

  | docs | before: shard (gzip / parse) | after: largest shard (gzip / parse), shard count |
  |---|---|---|
  | 1,000 | 178.9 KB / 51 ms | 19.9 KB / 4.9 ms (25 shards) |
  | 10,000 | 1.57 MB / 566 ms | 46.8 KB / 12.2 ms (129 shards) |
  | 100,000 | 14.83 MB / 6,966 ms | 197.1 KB / 54.5 ms (425 shards) |

  At 100k docs the worst-case per-query fetch drops ~75x in bytes and
  ~128x in parse time — and, more importantly than any single ratio, the
  *growth curve* flattens dramatically: a 100x corpus-size increase
  (1k→100k) now only grows the worst-case shard ~10x (19.9KB→197.1KB),
  not the ~83x the unsharded vocabulary grew (178.9KB→14.83MB) — much
  closer to (not perfectly) the "flat first-query cost as the corpus
  grows" property `docs/02`'s sharding design exists to guarantee; the
  residual growth is the honest remainder of a few very common terms'
  own posting lists growing with corpus size, which prefix granularity
  alone can't bound (see the binary-tier note above). This *does* cost
  something on the write side: `writeIndex()`'s 100k run went from ~91s
  to ~209s, since real sharding now runs a gzip-based size check per
  candidate prefix bucket (recursively, for any over-budget one) instead
  of writing one shard outright — a one-time build-time cost, paid once
  per deploy, traded for the query-time win above.
- ✅ Binary-vs-JSON postings benchmark: a minimal delta+varint binary
  postings codec matching
  [../specs/binary-format.md](../specs/binary-format.md)'s own baseline
  recommendation, benchmarked against the largest single prefix shard
  (the real per-query worst case, per the prefix-sharding fix above) at
  1k/10k/100k docs, every result round-trip-verified byte-identical to
  the JSON source. Deliberately investigation-only code (not part of
  `@ktjn/searchable-format`/`@ktjn/searchable-indexer`'s shipped API) — see
  [../investigations/binary-vs-json-index.md](../investigations/binary-vs-json-index.md) for the full
  writeup. The one-off program was removed after the investigation
  concluded; the measurements remain in that decision record and the
  shipped codecs are covered by package tests. Two findings, in opposite
  directions: the gzip size win is
  far larger than this investigation's earlier illustrative estimate and
  grows with corpus size (11x at 1k docs, 41x at 100k), but a naive
  whole-shard binary decode is currently *slower* than native
  `JSON.parse` at small/medium scale and only breaks even at 100k —
  contradicting the "avoid parse cost" framing for *this specific,
  unoptimized decoder*. Building the binary tier as a real feature needs
  lazy per-term posting decode (not whole-shard decode, which this
  benchmark only measures for a fair baseline) to plausibly turn that
  into a real win.
- ✅ Lazy per-term decode prototype: re-encoded the same largest-shard
  baseline into a directory-based layout (sorted
  term → byte offset/length table + postings blob, per
  [spec-binary-format.md](../specs/binary-format.md#dictionary-encoding)'s
  own baseline) so a specific term's postings decode by seeking directly
  to its byte range, without touching any other term — every result
  round-trip-verified against the full JSON-parsed shard. **This does
  flip the previous benchmark's finding**: decoding the directory plus a
  simulated 1-3-term query's *busiest* (highest-df, most expensive
  plausible) terms is 1.0x-9.5x faster than `JSON.parse`, not slower, at
  every corpus size tested. The win's *size* has a genuinely non-obvious
  dependency the numbers expose: it shrinks as the shard's own term
  *count* shrinks (down to ~1.0x, no real win, at 100k docs' 3-term
  largest shard), not as corpus size grows — because lazy decoding wins
  by skipping unused terms, and a shard with few terms has little to
  skip. Full numbers and interpretation in
  [../investigations/binary-vs-json-index.md](../investigations/binary-vs-json-index.md). Building
  the binary tier for real should use this directory-based, lazy-decode
  design, not a whole-shard decode step. The one-off program was removed
  after the investigation concluded; the measurements remain in the
  linked decision record and the shipped codecs are covered by package
  tests.
- ✅ Binary tier codec — term shards
  (`packages/indexer/src/binary-term-shard.ts` for the encoder,
  `packages/client/src/binary-term-shard.ts` for the decoder,
  `writeIndex(built, outDir, { termShardFormat: "binary" })`): the two
  benchmarks above's proof-of-concept promoted into a real, shipped,
  opt-in feature — the same directory-based, lazy-per-term-decode
  design, now wired end-to-end. Per-shard, not global (`format:
  "binary"` on that shard's manifest entry, per
  [spec-binary-format.md](../specs/binary-format.md#manifest-integration)'s
  "a deployment may mix JSON and binary files" allowance).
  `packages/client/test/binary-term-shard.test.ts` proves
  `spec-binary-format.md`'s success criterion directly: the same corpus
  built both ways returns identical hit ids *and* identical scores over
  real HTTP for exact-term, prefix (`term*`), multi-term AND, `"quoted
  phrase"`, synonym-expanded, fuzzy-matched, facet-filtered, and
  document-boosted queries — not just that both return non-empty
  results.
- ✅ Binary tier codec — fuzzy shards and doc store
  (`packages/indexer/src/binary-fuzzy-shard.ts` /
  `binary-doc-store.ts` for the encoders,
  `packages/client/src/binary-fuzzy-shard.ts` / `binary-doc-store.ts`
  for the decoders, `writeIndex(built, outDir, { fuzzyShardFormat:
  "binary", docStoreFormat: "binary" })`): extends the term shard's
  directory-based, lazy-per-key-decode design to two more shard types,
  chosen by re-checking each remaining shard type's actual access
  pattern in `search.ts` rather than encoding everything uniformly —
  fuzzy shards share the term shard's exact "large dictionary, few keys
  touched per query" shape (a fuzzy dictionary can be as large as the
  term vocabulary itself, but a query only looks up a handful of
  specific deletion-variant keys), so the same design applies directly
  without its own from-scratch benchmark; the doc store is motivated
  differently — there is (today) exactly *one* doc store shard for the
  whole corpus regardless of size, so *every* query previously fetched
  and parsed every document in the corpus even for a handful of hits,
  which the same lazy-decode-by-id technique fixes. Facet shards were
  deliberately **not** given a binary tier in this slice: `search.ts`
  usually decodes a facet shard's `values` in full to compute aggregate
  facet-count results, the opposite access pattern from what makes lazy
  per-key decode a win — building one properly would need its own
  filter-only-vs-aggregate-results design, not a mechanical rename of
  the term-shard technique (see
  [02-index-format.md](../../concepts/index-format.md)). Synonym/pins
  shards stay JSON too: both are small, author-curated data with no
  demonstrated size problem to justify the added complexity. Also
  extracted a shared `ByteWriter`/`ByteReader` (`packages/indexer/src/byte-writer.ts`,
  `packages/client/src/byte-reader.ts`) once a third encoder/decoder
  pair needed the exact same varint/string/float64 primitives, rather
  than a fourth copy-paste. Proven with the same rigor as the term
  shard's own equivalence test
  (`packages/client/test/binary-fuzzy-shard.test.ts`,
  `packages/client/test/binary-doc-store.test.ts`): identical hit ids
  for a fuzzy-matched typo query, identical "did you mean" suggestions
  (including a deliberately-constructed distance-2-via-symmetric-delete
  case that fails strict fuzzy matching but still surfaces as a
  suggestion), and identical `url`/stored `fields`/`score` — the last
  exercising the float64 `csf-boost` round-trip — for both formats
  built from the same corpus.
- ✅ Doc store multi-shard splitting (issue #1 finding 6,
  `WriteIndexOptions.docStoreShardSize`,
  `packages/indexer/src/write-index.ts`'s `chunkDocStoreByIdRange()`):
  the doc store used to always be exactly one physical shard covering
  the whole corpus regardless of size, so this project's own "scales
  past toy corpora" positioning was in tension with a query having to
  fetch that single, ever-growing file. `docStoreShardSize` splits it
  into multiple contiguous-id-range shards instead — the client's
  `fetchDocStoreEntriesByIds()` (`packages/client/src/search.ts`) was
  already written generically to fetch only the shard(s) whose
  `idRange` overlaps a query's hit ids, so this option is the only
  change a deployment needs to make; no client changes were required.
  Defaults to `Number.POSITIVE_INFINITY` (today's single-shard
  behavior, matching every existing build/test byte-for-byte) — an
  explicit opt-in for a corpus large enough that this matters. Combines
  independently with `docStoreFormat: "binary"` above (shard count
  bounds fetch size, binary format bounds per-shard decode cost).
  Verified over real HTTP
  (`packages/client/test/doc-store-sharding.test.ts`): a query whose
  hits straddle a shard boundary returns byte-identical results to an
  unsharded build of the same corpus, and — the actual point — a
  `fetch` spy confirms a query hitting one shard's id range never
  fetches the others, while a query spanning every shard's range
  fetches all of them.
- Still missing before this is a complete binary tier: a
  Range-request-capable single-file postings variant, an optional WASM
  scoring core, federated multi-index search, and a facet-shard binary
  encoding with its own filter-vs-aggregate design — see
  [../investigations/binary-vs-json-index.md](../investigations/binary-vs-json-index.md) and
  [../specs/binary-format.md](../specs/binary-format.md) for what's left. A
  query planner ([../specs/query-planner.md](../specs/query-planner.md)) and
  storage abstraction ([../specs/storage-api.md](../specs/storage-api.md)) are
  drafted extensibility groundwork for this phase's scale work, not yet
  built.

**Phase 8 — Vector & hybrid search**
- ✅ Storage/similarity mechanics — chunking
  (`packages/indexer/src/chunk-text.ts`: deterministic overlapping-window
  splitting, ~200/~20-token defaults), a vector-shard builder
  (`packages/indexer/src/build-vectors.ts`'s `buildVectorShards()`, an
  async function kept separate from the deliberately-synchronous
  `buildIndex()`), int8 scalar quantization (default, per-shard min/max)
  plus exact `float32` storage, one vector shard per language
  (`Manifest.vectors`, matching the `pins`/`synonyms`/`fuzzy` per-language
  shape), brute-force cosine similarity
  (`packages/client/src/vector-search.ts`), and Reciprocal Rank Fusion as
  the default hybrid-combination method (a min-max-normalized
  weighted-score mode is available via `options.vectorWeight` as an
  override). `SearchClient.search(query, { mode: "vector" | "hybrid" })`,
  with `SearchClientOptions.embedQuery` as the query-time embedding seam
  and `VectorSearchNotConfiguredError` thrown clearly when it's missing.
  Full design in
  [../../guides/vector-search.md](../../guides/vector-search.md), now
  annotated with what's actually built. Proven end-to-end over real HTTP
  and through a real Worker
  (`packages/client/test/vector-hybrid-search.test.ts`,
  `packages/client/e2e-browser/vector-search.spec.ts`) with a
  deterministic "concept bucket" synthetic embedder that demonstrates the
  actual point of vector search — surfacing a document sharing zero
  literal query terms, which the lexical pipeline alone provably misses
  in the same test.
- ✅ Real local-model embedding integration —
  `createTransformersEmbedder()` (`packages/indexer/src/transformers-embed.ts`)
  for the offline/build-time half and `createTransformersEmbedQuery()`
  (`packages/client/src/transformers-embed.ts`) for the query-time half,
  both backed by `@huggingface/transformers`, defaulting to the same
  model (`Xenova/all-MiniLM-L6-v2`, 384-dim) on both ends. The client
  half is a `devDependency` + optional `peerDependency` only, loaded via
  a lazy `import()` and listed in `rollupOptions.external`, so it costs
  nothing against the 15KB core bundle budget unless a consumer actually
  calls it. **Caveat**: this development session's sandbox blocks
  egress to `huggingface.co` (where model weights are fetched from on
  first use) by organizational policy, so the batching/slicing/lazy-
  load-caching plumbing is verified with a mocked `pipeline`
  (`packages/indexer/test/transformers-embed.test.ts`,
  `packages/client/test/transformers-embed.test.ts`), not a completed
  real-model download in this session. Each test file also carries an
  explicitly opt-in real-model test, gated behind
  `CSF_TEST_REAL_TRANSFORMERS=1` and skipped by default, for
  environments that do have that network access.
- Still not built: a remote embedding-API option (`embed`/`embedQuery`
  stay an arbitrary injectable seam either way, so this is additive, not
  blocking); binary (1-bit) quantization; IVF-style coarse clustering for
  larger corpora; WASM-accelerated scoring. All explicitly named as
  future opt-ins in
  [../../guides/vector-search.md](../../guides/vector-search.md), not
  day-one requirements.

**Showcase (runs alongside, not a phase of its own)**
- A GitHub Pages demo is staged against the phases above rather than
  built all at once — see
  [./github-pages-showcase.md](./github-pages-showcase.md).
  - ✅ Stage 0 (docs site) — [`showcase/`](../../../showcase/): every
    `docs/*.md` + `README.md` rendered to a small static site (nav,
    cross-link rewriting), no framework.
  - ✅ Stage 1 ("search these docs") — the real `@ktjn/searchable-indexer` runs
    against Stage 0's rendered output, the real `@ktjn/searchable-client` (Worker
    execution included) powers a search box on every page. Verified in
    a real browser via Playwright, including at a Pages-style subpath
    deployment (`/repo-name/`, not domain root) — which caught a real
    bug (a dynamic `import()` resolving against its own module's URL,
    not the page's) that testing only at server root would have missed.
    Deploys via
    [`.github/workflows/deploy-pages.yml`](../../../.github/workflows/deploy-pages.yml)
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
    ([`showcase/build-gallery.ts`](../../../showcase/build-gallery.ts),
    [`showcase/build-gallery-synonyms.ts`](../../../showcase/build-gallery-synonyms.ts),
    [`showcase/build-gallery-i18n.ts`](../../../showcase/build-gallery-i18n.ts),
    verified end-to-end with real-browser Playwright tests). Each
    demo's manifest/shards are kept entirely separate from the docs
    site's search index and from each other (`build-search.ts` skips
    `dist/gallery/`), per
    [19-github-pages-showcase.md](./github-pages-showcase.md#stage-2--feature-gallery-needs-phases-2-5)'s
    "not one shared mega corpus" design. `Intl.Segmenter` CJK handling,
    RTL rendering, and per-language stemming differences remain
    unbuilt (blocked on Phase 4 itself, not this stage).
  - ⬜ Stage 3 (semantic search demo): Phase 8's storage/similarity
    mechanics are built, and a real local embedding model integration now
    exists (`createTransformersEmbedder`/`createTransformersEmbedQuery`,
    above) — but building this demo means actually running the indexer
    with that model against the showcase's own docs corpus at build
    time, which needs network access to `huggingface.co` that this
    development session's sandbox doesn't have. No longer blocked on the
    *mechanism*, just on running a build with that network access
    available.

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
  [../../getting-started/overview.md](../../getting-started/overview.md)).
- **Personalization/ML ranking.** Out of scope for the core (see
  non-goals), but should the API leave a documented extension point
  (e.g. a client-side re-ranking hook fed a feature vector per hit) so
  consumers can layer their own signals without forking the engine?
- ~~**Vector/semantic search.**~~ Resolved into a concrete design — see
  [../../guides/vector-search.md](../../guides/vector-search.md) and
  Phase 8 above. Remaining open sub-question: whether shipping a
  client-side embedding model (tens of MB) is an acceptable default cost
  for deployments that enable `plugin:vector`, or whether the remote-API
  escape hatch ends up being the common case in practice — needs real
  deployments to answer, not speculation.
- ~~**Auto language detection accuracy.**~~ Resolved in favor of the
  zero-bundled-model side of the tradeoff: `detectLanguage()`
  (docs/03-tokenization-i18n.md#auto-language-detection, Phase 4 above)
  answers "how much bundled model size" with "none" — script-based
  detection for CJK plus curated function-word lists for Latin-script
  profiles, only ever as a fallback when `<html lang>` is absent.
  Genuinely lower accuracy than a trained model for languages without a
  word list added, or for short/mixed-language text — an accepted
  tradeoff, not a claim of matching dedicated langid libraries, and
  explicit tagging remains strictly preferred whenever a deployment can
  provide it.
- **Cross-index score normalization** (federated search,
  [07-client-api.md](../../reference/client-api.md)) —
  min-max vs z-score vs learned normalization; needs empirical testing
  against real multi-corpus fixtures before picking a permanent default.
- **Result diversification / near-duplicate collapsing.** Today every
  matching document is its own hit, full stop — no de-duplication or
  per-group cap. Worth a `groupBy` (e.g. cap hits per URL prefix or per
  facet value) and/or a near-duplicate detector (e.g. shingled
  minhash over indexed text) so a corpus with many similar/boilerplate
  pages doesn't crowd out diverse results? No concrete driver yet;
  revisit once a real deployment's result pages show the symptom.
- **Freshness decay and authority/importance boosting.** BM25F plus
  configured field/doc/term boosts ([../../guides/ranking-and-boosts.md](../../guides/ranking-and-boosts.md))
  is purely content-relevance-based today — no notion of "this page is
  newer" or "this page is more authoritative" absent an explicit boost
  the deployment configures by hand. A generic time-decay function
  (needs a `publishedAt`/`updatedAt` field convention) or a
  precomputed authority score (e.g. internal-link count) are both
  plausible, but both need a concrete corpus with a real staleness or
  authority problem before picking a formula — easy to overfit a decay
  curve to no actual data.
- **Query rewrite beyond "did you mean".** Fuzzy matching already
  surfaces a "did you mean" suggestion string
  ([04-query-ranking-boosts.md](../../guides/ranking-and-boosts.md)),
  but never auto-applies it — the consumer's UI decides whether to
  re-run the corrected query. Should the API offer an opt-in
  auto-rewrite-and-rerun mode (return the corrected-query's hits
  directly when the original query returns zero results), or does
  that surprise users by silently changing what they searched for?
  Leaning toward keeping today's suggest-only behavior as the default
  either way.

## Explicit non-features (revisit only with a concrete driver)

- Real-time index mutation from the browser (this is a read-only
  runtime by design).
- Server-side query logging/analytics baked into core (left as an
  observability hook, see [08-modern-features.md](../../concepts/architecture.md)).
- Built-in UI components beyond example code (kept as separate optional
  packages so core stays framework-agnostic).
