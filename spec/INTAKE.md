# Brownfield intake and gate record — Level 1 (Architecture)

Copied from [`system-spec/templates/BROWNFIELD-INTAKE.md`](../system-spec/templates/BROWNFIELD-INTAKE.md).
Level 0 history is preserved below; this update advances to Level 1
(`architecture`). Levels 2 (verification) and 3 (release) are future work —
see "Remaining adoption work".

## Scope and authority

| Record | Observed value |
|---|---|
| Repository / source revision | `ktjn/searchable`. Level 0 baseline `cfbe583d5fec1381852df956cab0449339a9d39e` (merged #167); this update built on top of it |
| Adoption scope | Whole product, coarse component/capability boundaries. Excluded/deferred: `showcase/` (docs/demo site), `tools/fixtures`, `tools/relevance` (dev tooling, not a deployable unit) — see decision below |
| Existing authorities | `README.md`, `docs/reference/python-client-api.md`, `CLAUDE.md` (two-client-implementation policy); `spec/schema/*.schema.json` (authoritative index-format schemas); these remain authoritative over this spec |
| Tool map | Product gate is `scripts/gate.sh` (`pnpm gate`). `system-spec` validates `spec/system.yaml` only; it does not replace or subsume the product gate |
| Validator / schema pin | `system-spec-ref` 0.2.0 (PyPI wheel), exported snapshot committed at `system-spec/` |
| Native gates | `pnpm gate` (local, required before push via `.githooks/pre-push`); CI runs lint/build/typecheck/`uv build` plus the spec validation added in #167 |
| Ownership | Author: this onboarding work. Acceptance owner: repo maintainer (`ktjn`). Remediation owner for the one open waiver: unassigned (see below) |

## Boundaries and dependencies

| Unit / entrypoint | Internal, external, deferred or unknown | Observed provider / consumer / state owner | Evidence / unresolved mapping |
|---|---|---|---|
| `python-analysis` (`python/searchable/src/searchable/analysis`) | Internal | Provides `analyze-text` (tokenize/segment/stem/detect-language); required by both `python-indexer` (build time) and `python-client` (query time) | Both import `searchable.analysis` directly |
| `python-indexer` (`python/searchable/src/searchable/indexer`) | Internal | Provides `build-index`; owns all index data models (manifest + 6 shard kinds) | `pyproject.toml` entry point `searchable = "searchable.cli:main"` |
| `python-client` (`python/searchable/src/searchable/client`) | Internal | Provides `query-index` (one of two providers of this capability — see below) | No shared mutable state with the indexer |
| `ts-client` (`packages/searchable/src`) | Internal | Provides `query-index` (the second provider). Has its own **duplicate** `analysis/` implementation (`packages/searchable/src/analysis/`) rather than requiring `python-analysis` — the two runtimes cannot share code across the JS/Python boundary, so `analyze-text` is modeled as a Python-only cross-component capability; the TS copy is private/internal to `ts-client` and not separately modeled | `CLAUDE.md` "Two client implementations": the two providers of `query-index` are required to stay behaviorally equivalent, verified by `packages/searchable/test/client-conformance.test.ts` |
| GitHub Packages / PyPI registries | External, deferred | Publish-time only (`publish.yml` workflow); not exercised at this level | Out of scope; revisit only if release automation itself needs modeling |
| `showcase/` app | **Excluded (decision made this level)** | Consumes `ts-client` and the Python builder for docs/demo generation; not a shipped product component, has no published artifact or version of its own | Tommy confirmed proceeding with the Level 1+ onboarding; showcase exclusion follows the Level 0 default and was not challenged. Revisit only if showcase gains its own release/versioning |

`analyze-text` crossing from build-time (`python-indexer`) to runtime (`python-client`) forced `system.layers` to list `runtime` before `build` (dependencies flow toward later-listed layers) — this is a modeling artifact of the toolkit's layer-violation check, not an architectural claim that "build" sits below "runtime" in the product.

No `external_sources` are registered: the library builds and searches a static index with no third-party runtime dependency.

## Data and evidence

- `data_models`: `index-manifest` (owner `python-indexer`) plus its six owned shard kinds (`term-shard`, `doc-store-shard`, `facet-shard`, `synonym-shard`, `pins-shard`, `fuzzy-shard`), all `derived_from: [index-manifest]`. Fields are taken directly from `spec/schema/*.schema.json` (authoritative); none invented.
- `python-indexer` owning 7 data models exceeds the default `COMP-03` budget of 4. Overridden via `context_budget.max_owns_data: 7` rather than splitting: all 7 are one atomic build output (one `build-index` call produces the manifest and every shard together), so splitting them into separate components would fragment a single consistency/transaction boundary — the same reasoning the toolkit itself documents for Modelable's compilation DTOs.
- `doc-store-shard` stores whatever document fields the *caller* chooses to index (arbitrary pass-through content) — this library has no fixed knowledge of what's stored, so classification can't be observed. Set to `restricted` (most conservative, not "public" by default per the toolkit's own rule) with an active `classification_review` requirement (`classify-stored-document-fields`) recording that any specific deployment must redo this classification against its real field content before *that deployment* is itself onboarded.
- All other data models are classified `public`: they describe index-structure metadata (term postings, facet buckets, doc counts), not caller content.
- Capability contracts (`CAP-01`): `preconditions`/`postconditions`/`invariants`/`failure_modes` for `analyze-text`, `build-index`, `query-index` are grounded in observed code (`analyze()` in `analysis/analyze.py`, `_validate_boost` in `indexer/build_index.py`, `InvalidManifestError` in `client/validate_manifest.py`), not invented. `analyze-text` additionally declares an `interface` (`CAP-02`/`CAP-03`) because it's required cross-component; `build-index`/`query-index` aren't required by any other component in this spec, so no interface was forced for them.
- No `Evidence` yet — characterization-test binding is Level 2 scope.

### Known tool limitation: `--check-drift` false positives

`--check-drift --root .` flags `term-shard`, `doc-store-shard` and `pins-shard` ("has no top-level properties") because those three JSON Schemas are keyed maps (`propertyNames` + `additionalProperties`, e.g. `{term: postings}`), not a fixed `properties` object — the checker only diffs top-level `properties` and can't represent a dynamic-key map. This is a real limitation of the diagnostic (consistent with WIRING.md's documented drift limits), not a defect in the data models or schemas. CI runs this check as informational (`continue-on-error`) rather than gating on it.

## Gate decision and feedback

| Gate / precise scope | Observed evidence and skips | Pass, rework or scoped waiver | Remaining obligation, owner and expiry |
|---|---|---|---|
| Inventory | See Level 0 record in PR #167 history | **Pass** (unchanged) | — |
| Architecture | `system-spec spec/system.yaml --stage architecture` → `VALID`; `--check-artifacts --root .` → `VALID`; `--check-drift --root .` → 3 known false-positive warnings (see above) | **Pass** | One active waiver: `doc-store-shard` classification is a conservative policy default (`restricted`), not an observed fact — `classify-stored-document-fields` requirement tracks it, no expiry set (it's deployment-scoped, not time-scoped) |
| Verification | Not attempted | Open | Requires: as-is capability characterization tests bound as `Evidence` (candidates: `client-conformance.test.ts` for `query-index` equivalence, `python/searchable/tests/` for `build-index`/`analyze-text`), coverage of the 10 verification categories or scoped waivers for the rest |
| Release | Not attempted | Open | Requires closing all Level 2 waivers; no waivers permitted at this stage |

## Remaining adoption work

- Level 2 (verification): bind existing test suites as `Evidence` with `subject_bindings` (contract version + source revision + file hashes); the repo already has strong candidate coverage (278 vitest + the Playwright suite + Python `pytest`) but none of it is bound to this spec yet.
- Level 3 (release): close all waivers, including the `doc-store-shard` classification one — which, being deployment-scoped rather than this-library-scoped, may never fully close for a general-purpose library and could instead become a permanent documented caveat for embedders (a model question worth raising with the toolkit maintainer per self-improvement feedback, not something this repo can resolve unilaterally).
- No model gaps found worth reporting as toolkit feedback this round — the layer-ordering direction and `context_budget` override both had documented, working escape hatches.
