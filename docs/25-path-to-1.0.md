# Path to 1.0

**Relationship to other docs**: [09-roadmap.md](09-roadmap.md) tracks
*build* status (what has working code) and
[23-implementation-roadmap.md](23-implementation-roadmap.md) tracks which
*specs* still need writing. Neither says when or how to actually cut a
1.0 release. This doc is that plan — a release-engineering sequence, not
another feature list. (A prior version of this idea,
`docs/25-modern-search-features.md`, was a duplicate feature wishlist and
was deleted — its content is folded into 09's Open Questions. This doc
deliberately does not repeat that mistake: everything below is about
*shipping* what already exists, not designing more of it.)

## What 1.0 actually commits to

Every package here is still `0.0.0`. Per
[22-project-governance.md](22-project-governance.md)'s Compatibility
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

### Iteration 2 — Make the index-format version real

- `SearchClient` never checks `Manifest.version` against what it
  supports — an incompatible future index format would fail with
  whatever confusing error falling out of a shape mismatch produces,
  not the "clear compatibility error" 22-project-governance.md commits
  to. Add that check now, before 1.0, while there's still only one
  version number in the wild.
- Document the client-version ↔ index-version support matrix (even if
  today it's the trivial "client 1.x supports index format 1").
- Exit criteria: a manifest with an unrecognized `version` throws a
  named, documented error instead of failing opaquely; a test proves it.

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
  [19-github-pages-showcase.md](19-github-pages-showcase.md)) once that
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
