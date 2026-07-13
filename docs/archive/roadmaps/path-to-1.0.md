# Path to 1.0

**Relationship to other docs**: [./implementation-history.md](./implementation-history.md) tracks
*build* status (what has working code) and
[./specification-roadmap.md](./specification-roadmap.md) tracks which
*specs* still need writing. Neither says when or how to actually cut a
1.0 release. This doc is that plan — a release-engineering sequence, not
another feature list. (A prior version of this idea,
`docs/25-modern-search-features.md`, was a duplicate feature wishlist and
was deleted — its content is folded into 09's Open Questions. This doc
deliberately does not repeat that mistake: everything below is about
*shipping* what already exists, not designing more of it.)

## What 1.0 actually commits to

Every package here is still `0.0.0`. Per
[../../project/governance.md](../../project/governance.md)'s Compatibility
Policy, "public APIs should remain stable within a major version" — that
promise doesn't exist yet, because there's no major version. Cutting 1.0
means:

- Freezing the public API surface of `@csf/client` and `@csf/indexer`
  (the two packages a consumer actually installs) and committing to
  semver for it going forward.
- Making the manifest/index-format version number
  (`packages/format/src/index.ts`'s `version: 1`) mean something at
  query time, not just exist as a type field.
- Having a changelog, a publish pipeline, and a tagged release —
  currently none of the three exist.

1.0 is a release-engineering milestone on top of already-built
functionality, not a rewrite. Phases 0–6 of 09-roadmap.md are fully
built and tested (496 Vitest + 40 Playwright tests); the work below is
about drawing a line around that and shipping it, not extending it.

## Scope: what ships in 1.0

**In, and stable as of 1.0** (all already implemented — see
09-roadmap.md's Status section for the evidence):
lexical search (BM25F, boosts, prefix/phrase), facets (terms/range/
hierarchical), pins, synonyms, fuzzy matching, i18n (English/German real
stemmers, CJK/Thai-Khmer-Lao n-gram fallback, auto-detect, RTL), Web
Worker execution, offline Service Worker caching, highlighting,
streaming results, cancellation, observability hooks.

**In, but explicitly marked experimental/opt-in in 1.0** (won't be
covered by the 1.0 API-stability guarantee — may still change shape in a
later minor without a major bump): the binary storage tier
(`termShardFormat`/`fuzzyShardFormat`/`docStoreFormat: "binary"`) and
vector/hybrid search (`mode: "vector" | "hybrid"`,
`createTransformersEmbedder`/`createTransformersEmbedQuery`). Both are
real, tested, shipped code — but both are also the newest, least
battle-tested surfaces, and 09-roadmap.md itself lists open sub-questions
for each (facet-shard binary encoding design, remote-embedding-API
tradeoff). Shipping them as "opt-in, may still evolve" rather than either
holding 1.0 hostage to fully resolving those questions or silently
promising stability we haven't earned.

**Explicitly deferred past 1.0** (not blockers — already documented as
such, listed here only to make the 1.0 cut line explicit): incremental
index updates, personalization hook, cross-index score normalization,
result diversification, freshness/authority boosting, auto-rewrite
query mode, remote embedding API, binary quantization/IVF clustering,
WASM scoring, range-request single-file binary variant, federated
search, facet binary encoding, a real (non-draft) query planner /
storage abstraction / plugin API (specs stay draft per
23-implementation-roadmap.md), showcase Stage 3.

## Iteration plan

### Iteration 1 — API surface audit & freeze

- Enumerate every exported symbol from `@csf/client` and `@csf/indexer`
  (their `index.ts` barrel exports). Classify each as stable-for-1.0 or
  experimental (binary tier / vector-hybrid, per Scope above).
- Decide `@csf/analysis`, `@csf/format`, `@csf/fixtures` publication
  status: `@csf/format` and `@csf/analysis` are real dependencies of the
  public packages and need their own stable exports too;
  `@csf/fixtures` is test-only tooling (`@csf/fixtures`' own
  description says "Phase 0 reference fixture corpus") and should ship
  `"private": true` rather than be published to npm at all.
- Write the ADRs `docs/adr/` was supposed to hold all along
  (22-project-governance.md names index format, ranking model, storage
  abstraction, compatibility policy, plugin API as ADR-worthy — none
  exist yet). These can be written retroactively from the design docs
  that already justify each decision; the point is having a permanent,
  dated record before 1.0 freezes them.
- Exit criteria: a table of every public export, stable vs experimental,
  committed to the repo (can live in this doc or a new `API.md`).

**Done**: [`docs/../../adr/`](../../adr/) now holds five retroactive ADRs (pull-based
static HTTP transport, JSON-first format with opt-in binary tier, BM25F
ranking, the semver/manifest-version compatibility split, and the
core-vs-opt-in plugin boundary), indexed in
[`docs/../../adr/README.md`](../../adr/README.md). Export audit, from each package's
`index.ts` barrel:

| Package | Stable for 1.0 | Experimental (may change in a minor) |
|---|---|---|
| `@csf/client` | `SearchClient` (+ `SearchClientOptions`, `SearchClientEventMap`), `search()`/`searchStream()`/`facetValues()`/`ready()`/`dispose()`/`on()`, `Hit`/`SearchResult`/`SearchOptions`/`FacetResult*`/`RangeFilter`, `HighlightSpan`/`HighlightTerm`, `registerOfflineCaching`/`OfflineCacheOptions`, `validateManifest`/`InvalidManifestError`/`ValidateManifestOptions`, `isRtlLanguage` | `createTransformersEmbedQuery` + its types, `cosineSimilarity`/`reciprocalRankFusion`/`dequantizeVector`/`DEFAULT_RRF_K`, `VectorHit`, `VectorSearchNotConfiguredError`/`VectorProviderMismatchError`, `EmbeddingProviderConfig` — everything under `mode: "vector"/"hybrid"`, per ADR-0002/0005 |
| `@csf/indexer` | `buildIndex`/`BuildIndexOptions`, `discoverHtmlDocuments`, `extractDocument` + its types, `writeIndex`/`WriteIndexOptions`, the core `Manifest`/`TermShard`/`FacetShard`/`DocStoreShard`/`PinsShard`/`SynonymShard`/`FuzzyShard`/posting types | `buildVectorShards`/`BuiltVectors`/`VectorsBuildOptions`, `chunkText`/`Chunk`, `createTransformersEmbedder` + its types, `VectorEntry`/`VectorShard`/`EmbeddingProviderConfig`, and `WriteIndexOptions`'s `termShardFormat`/`fuzzyShardFormat`/`docStoreFormat` binary-tier knobs |
| `@csf/format` | Every type mirroring the JSON-tier manifest/shard shapes | The `vectors` field, `VectorEntry`/`VectorShard`/`EmbeddingProviderConfig`, and every shard's `format?: "binary"` variant — these evolve alongside the experimental features above |
| `@csf/analysis` | Everything (`analyze`/`normalizePhrase`/`Token`, `detectLanguage`, `isRtlLanguage`, all `LanguageProfile`s, `getLanguageProfile`/`getRegisteredLanguageCodes`, `getOrCreate`/`ownProp`, both segmenters, both stemmers) — this is the core i18n pipeline with no experimental slice. `getOrCreate`/`ownProp` are an internal correctness primitive shared between `@csf/indexer` and `@csf/client` (Iteration 5's prototype-collision fix) rather than something a consuming app is expected to call directly, but they're technically reachable through the public barrel like everything else here, so they're listed rather than left undocumented | — |
| `@csf/fixtures` | N/A — test-only tooling, not part of the public API at all (see Iteration 3: ships `"private": true`, never published) | — |

A breaking change to a "stable" cell after 1.0.0 needs a major bump per
[../../project/governance.md](../../project/governance.md); a breaking change
to an "experimental" cell only needs a changelog note.

### Iteration 2 — Make the index-format version real

**Already done, corrected from this doc's first draft**: an earlier pass
of this doc claimed `SearchClient` never checks `Manifest.version`. That
was wrong — `validateManifest()`
(`packages/client/src/validate-manifest.ts`) already rejects any
`version !== 1` with a named `InvalidManifestError` ("unsupported
version N (expected 1)"), is called on every manifest load in
`client.ts`, and is covered by a test
(`packages/client/test/validate-manifest.test.ts`'s "rejects an
unsupported version"). Nothing to build here. The one remaining item:

- Document the client-version ↔ index-version support matrix explicitly
  somewhere durable (today it's the trivial "client 1.x supports index
  format 1" — worth stating once in
  [../../concepts/index-format.md](../../concepts/index-format.md) rather than only being
  implicit in `validateManifest`'s error message) so a future format
  bump has a documented place to add its own row instead of just editing
  the check in isolation.
- Exit criteria: the support matrix is written down in 02-index-format.md.

### Iteration 3 — Release engineering

- Add a root `CHANGELOG.md` (Keep a Changelog format), seeded with a
  summary of Phases 0–8 as the "1.0.0" entry — this retroactively
  satisfies 22-project-governance.md's Release Quality Checklist item
  ("Changelog is updated") which nothing has done yet.
- Decide lockstep vs independent per-package versioning. Recommend
  lockstep (`@csf/client`, `@csf/indexer`, `@csf/format`, `@csf/analysis`
  all move to the same version together): the packages are tightly
  coupled through the shared index format, and independent versioning
  would immediately need the client-version/index-version compatibility
  matrix from Iteration 2 to also cover cross-package-within-the-repo
  version skew, which is unneeded complexity for a workspace this
  interdependent.
- Bump the four publishable packages from `0.0.0` to `1.0.0` (or
  `1.0.0-rc.1` first — see Iteration 5); add `repository`/`homepage`/
  `bugs` fields to each `package.json` (currently absent everywhere,
  needed for a real npm listing).
- Add a `publish.yml` GitHub Actions workflow: on a `v*` tag, run the
  same install/lint/typecheck/size/test/test:browser steps `ci.yml`
  already runs, then `pnpm publish -r`. No such workflow exists today —
  `.github/workflows/` only has `ci.yml` and `deploy-pages.yml`.
- Exit criteria: `CHANGELOG.md` exists and is accurate; a tag push
  publishes all four packages to npm without manual steps.

**Done**: [`CHANGELOG.md`](../../../CHANGELOG.md) added at the repo root with
a `1.0.0` entry summarizing everything in the Scope section above.
Lockstep versioning chosen per the reasoning above — `@csf/client`,
`@csf/indexer`, `@csf/format`, and `@csf/analysis` are all now
`1.0.0`, each with `repository`/`homepage`/`bugs` fields added.
`@csf/fixtures` is now `"private": true` (test-only tooling, never
published — see Iteration 1's export audit). Added
[`.github/workflows/publish.yml`](../../../.github/workflows/publish.yml):
on a `v*` tag push, it re-runs every `ci.yml` check and then
`pnpm publish -r --access public --provenance` (private packages are
skipped automatically by `pnpm publish -r`), authenticating via an
`NPM_TOKEN` repo secret that still needs to be created before the first
real tag push — that's a one-time manual step outside this repo
(npmjs.org token generation + adding it under repo Settings → Secrets),
not something a workflow file can do for itself.

### Iteration 4 — Close the network-blocked gaps

Two things in 09-roadmap.md are marked incomplete specifically because
*this development sandbox* blocks egress to `huggingface.co`, not
because the code is unfinished:

- Run the already-written, currently-skipped
  `CSF_TEST_REAL_TRANSFORMERS=1` tests
  (`packages/indexer/test/transformers-embed.test.ts`,
  `packages/client/test/transformers-embed.test.ts`) in a CI job that
  actually has that network access, to validate
  `createTransformersEmbedder`/`createTransformersEmbedQuery` against
  real downloaded model weights instead of only a mocked `pipeline`.
- Build showcase Stage 3 (the semantic search demo,
  [./github-pages-showcase.md](./github-pages-showcase.md)) once that
  real-model path is validated — it needs the indexer to run with a
  real embedding model at build time, which the mechanism is ready for
  but has never actually been executed.
- Exit criteria: both real-model tests pass in CI at least once;
  Stage 3 is live at `gallery/index.html` alongside Stages 0–2.

### Iteration 5 — Hardening pass

- Run `/security-review` against `@csf/client`'s untrusted-input
  surfaces specifically: manifest/shard JSON parsing (fetched from
  wherever a consumer deploys it, not necessarily trusted), Worker
  `postMessage` protocol, Service Worker cache handling. This is a
  library that parses attacker-reachable JSON over plain HTTP by
  design — worth one dedicated pass before the API that touches it is
  frozen.
- Run `/code-review` at high effort focused on the Iteration 1 public
  API boundary and its error handling — mistakes there become permanent
  the moment 1.0 ships, per the compatibility policy.
- Walk 22-project-governance.md's Release Quality Checklist literally,
  item by item, as a go/no-go gate: tests pass, benchmarks show no
  regression (`pnpm bench`), docs current, compatibility verified
  (Iteration 2), index format changes documented, changelog updated.
- Exit criteria: checklist fully green, findings from both reviews
  either fixed or explicitly deferred with a reason.

**In progress**: a manual pass over the three Service Worker/Worker
ingestion surfaces (`fetch-json.ts`, `worker.ts`/`worker-protocol.ts`,
`sw.ts`) found and fixed one real gap — `sw.ts`'s `precache()` fetched
and trusted the manifest directly, without ever calling
`validateManifest()`, the one manifest-ingestion path (of three: main
thread, Worker, Service Worker) that skipped it. A manifest with a
cross-origin shard reference would have been blindly precached (and
later served offline) by the Service Worker alone, bypassing the
cross-origin-shard guard `client.ts`/`worker.ts` already enforce. Fixed:
`sw.ts` now validates the fetched manifest the same way, with a new
`OfflineCacheOptions.allowCrossOriginShards` (threaded through as a
query param on the registration URL, the same mechanism `mode`/
`languages` already use, since `register()` only accepts a script URL)
mirroring `SearchClientOptions.allowCrossOriginShards`. Covered by a new
real-browser Playwright test
(`packages/client/e2e-browser/offline.spec.ts`): a manifest with a
genuinely cross-origin (different port, same host, real second
`serveDir()` server) shard reference fails Service Worker install by
default, and installs cleanly once `allowCrossOriginShards: true` is
set — proving it's specifically the origin check, not an unrelated
fetch failure.

**Done**: followed that gap up with a manual pass (in lieu of
`/security-review`/`/code-review`, which are diff-scoped tools with
nothing to diff against once the fix above was merged) over the
remaining public API boundary — `client.ts` (constructor, `dispose()`,
the worker-message protocol, the vector-provider-mismatch check),
`search.ts`'s option handling, and `highlight.ts`'s regex construction.
Findings:
- No other dynamic `RegExp`/`Function`/`eval` construction anywhere in
  `@csf/client`, `@csf/indexer`, or `@csf/analysis` besides
  `highlight.ts`'s `buildPattern()` (grepped for it directly) — which
  escapes every term via `escapeRegExp()` before interpolating and uses
  only a flat alternation (no nested quantifiers), so it's not a ReDoS
  vector.
- `@csf/indexer` makes zero `fetch()` calls anywhere in its source —
  it's genuinely filesystem-only/offline as ADR-0001 describes, so
  there's no SSRF surface to check there.
- `client.ts`'s dedicated Worker channel needs no `event.origin` check
  (unlike `window.postMessage`) — a dedicated Worker's message channel
  is private to the page that created it, nothing else can post to it.
- No other issues found in that pass. `22-project-governance.md`'s
  Release Quality Checklist: tests/lint/typecheck/bundle-size all green
  (see the PRs executing this iteration); `pnpm bench` and a final
  documentation pass are still open, folded into Iteration 6 below
  rather than repeated here.

**Found and fixed a real, live one anyway** — not via a review tool,
but because this very doc's previous paragraph (above) used the word
"constructor" in prose, and the showcase's own CI build indexes
`docs/*.md` for real. That crashed `buildIndex()` in CI
(`TypeError: Cannot read properties of undefined (reading 'push')`),
which traced back to a systemic bug class: every plain-object
dictionary keyed by corpus- or query-derived strings (`TermShard`,
fuzzy deletion dictionaries, facet shards, the `@csf/analysis` language
registry, synonym/pins/vector manifest lookups) used a bare
`if (!dict[key])` / `key in dict` / `dict[key] ?? fallback` existence
check — every one of those is fooled by the prototype chain when `key`
happens to be an inherited `Object.prototype` member name
("constructor" is the one that survives this project's lowercasing
analysis unchanged; "toString"/"hasOwnProperty"/etc. fold to
non-colliding lowercase forms first, but facet *field* names come from
raw, un-lowercased `csf-facet-<field>` meta-tag suffixes, so those stay
exploitable too). A document containing the word "constructor" in
prose, a `csf-facet-constructor`/`csf-facet-range-hasOwnProperty` meta
tag, a `<html lang="constructor">`, or a search query for the literal
word "constructor" could each crash or silently corrupt scores.

Fixed at every location found, most critically
`@csf/analysis`'s `getLanguageProfile()` (`packages/analysis/src/registry.ts`) —
the root-cause fix, since it's called before any of the
language-keyed dictionaries downstream are ever touched, so making it
correctly throw its existing "no LanguageProfile registered" error for
a colliding code closes off that entire branch at once. Also fixed:
`build-index.ts`'s `addPostings`/`buildFuzzyShard`/`addFacetValues`/
`addRangeFacetValues`, `extract.ts`'s facet/range-facet meta-tag
parsing, and `search.ts`/`score.ts`'s query-time synonym/fuzzy/
language-keyed lookups — all via one shared `getOrCreate()`/`ownProp()`
in `packages/analysis/src/safe-dict.ts` (a small correctness primitive
now exported from `@csf/analysis`'s public barrel alongside
`getLanguageProfile`, since both `@csf/indexer` and `@csf/client`
already depend on that package and the bug class is identical on the
build-time and query-time side — first landed as two separately
duplicated files, one per package, then consolidated here in a
follow-up dedup pass so the write-time and read-time halves of this fix
can't drift apart independently). Covered by new regression tests:
`packages/indexer/test/prototype-safe-keys.test.ts` (a document body
containing "constructor", plus facet fields literally named
"constructor"/"hasOwnProperty") and
`packages/client/test/prototype-safe-keys.test.ts` (searching the
literal word "constructor" with synonyms+fuzzy enabled over real HTTP,
and `options.language: "constructor"` now failing with the same clear
"unsupported language" error any other unregistered code gets, instead
of a confusing crash deep in synonym/fuzzy lookup). Full suite still
green after the fix: 502 Vitest tests (6 new), 41 Playwright tests,
lint/typecheck/bundle-size all clean.

### Iteration 6 — Cut the release

- Tag `v1.0.0`; let Iteration 3's `publish.yml` publish all four
  packages.
- Cut a GitHub Release with `CHANGELOG.md`'s 1.0.0 entry as the body.
- Update README.md's "Status" section from today's "core engine is
  implemented and tested" framing to state the 1.0 API-stability
  guarantee explicitly, and point at this doc's Scope section for what
  is/isn't covered by it.

## Sequencing note

Iterations 1–3 can run in parallel (API audit, format-version check, and
release plumbing don't depend on each other). Iteration 4 is
independent and can start any time CI network access is confirmed.
Iteration 5 depends on 1–3 being done (nothing to freeze-review until
the surface is defined and versioned). Iteration 6 depends on
everything above.
