# Brownfield intake and gate record — Level 2 (Verification)

Copied from [`system-spec/templates/BROWNFIELD-INTAKE.md`](../system-spec/templates/BROWNFIELD-INTAKE.md).
Level 0/1 history is preserved below (see PRs #167, #168); this update
advances to Level 2 (`verification`). Level 3 (release) is future work —
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
- `requirements`/`evidence` (Level 2): one `Requirement` per verification category (`REQ-01`'s ten: `functional`, `semantic`, `contract`, `serialization`, `concurrency`, `performance`, `scalability`, `resilience`, `security`, `observability`), each bound to a capability or component and, where evidenced, to real passing tests already in the repo (every provenance path below was run and confirmed passing before being recorded, at revision `abd6e1111b0ab212f5fac095ae9febaca31d14ae`):

  | Category | Requirement | Evidence (provenance) |
  |---|---|---|
  | functional | `req-functional-analyze`, `req-functional` | `test_analyze.py`; `client-conformance.test.ts`, `test_build_index.py` |
  | semantic | `req-semantic` | `score.test.ts` (BM25F ranking) |
  | contract | `req-contract` | `validate-manifest.test.ts`, `test_validate_manifest.py` |
  | serialization | `req-serialization` | `test_schema_conformance.py` (built index vs. `spec/schema/*.schema.json`) |
  | scalability | `req-scalability` | `doc-store-sharding.test.ts` (shard-boundary-straddling queries) |
  | resilience | `req-resilience` | `cancellation.test.ts`, `client-lifecycle.test.ts` |
  | security | `req-security` | `static-server-security.test.ts` (path traversal), `prototype-safe-keys.test.ts` (prototype-pollution safety) |
  | performance | `req-performance` | `packages/searchable/scripts/check-bundle-size.mjs` (enforced gzip budget) |
  | concurrency | `req-concurrency` | **none yet** — waived, see below |
  | observability | `req-observability` | **none yet** — waived, see below |

- Two categories have no real characterization in the repo today, so they're honestly left unevidenced rather than backed by invented tests:
  - **concurrency**: nothing in the test suite exercises concurrent `build-index`/`query-index` calls against shared state. Waived via `risk-concurrency-coverage` (`mitigated_by: [req-concurrency]`, expires `2027-02-01`).
  - **observability**: the library has no logging/metrics/tracing surface for an embedder to hook into — this may turn out to be a real product gap, not just a spec gap. Waived via `risk-observability-coverage` (`mitigated_by: [req-observability]`, expires `2027-02-01`).
- Verified `--stage release` still correctly fails on both waivers (`RISK-08`: "no waivers permitted at release") plus `STAT-04`/`EV-04` (statuses below `verified`, no `subject_bindings`) — confirms Level 2 is scoped correctly and Level 3 work hasn't been silently skipped.

### Known tool limitation: `--check-drift` false positives

`--check-drift --root .` flags `term-shard`, `doc-store-shard` and `pins-shard` ("has no top-level properties") because those three JSON Schemas are keyed maps (`propertyNames` + `additionalProperties`, e.g. `{term: postings}`), not a fixed `properties` object — the checker only diffs top-level `properties` and can't represent a dynamic-key map. This is a real limitation of the diagnostic (consistent with WIRING.md's documented drift limits), not a defect in the data models or schemas. CI runs this check as informational (`continue-on-error`) rather than gating on it.

## Gate decision and feedback

| Gate / precise scope | Observed evidence and skips | Pass, rework or scoped waiver | Remaining obligation, owner and expiry |
|---|---|---|---|
| Inventory | See Level 0 record in PR #167 history | **Pass** (unchanged) | — |
| Architecture | See Level 1 record in PR #168 history | **Pass** (unchanged) | One active waiver: `doc-store-shard` classification (`classify-stored-document-fields`, no expiry — deployment-scoped) |
| Verification | `system-spec spec/system.yaml --stage verification` → `VALID`; `--check-artifacts --root .` → `VALID`. Every capability has ≥1 requirement (`CAP-04`); all 10 verification categories covered, 8 by real passing evidence and 2 by scoped waiver (`REQ-01`) | **Pass** | Two active waivers (`risk-concurrency-coverage`, `risk-observability-coverage`), both expiring `2027-02-01`, both mitigated by requirements with no evidence yet. Plus the carried-forward `classify-stored-document-fields` waiver |
| Release | Attempted as a diagnostic only (not a gate at this level) — fails as expected: `STAT-04` (nothing is `verified` status yet), `EV-04` (no `Spec.subject_bindings`), `RISK-08` (no waivers permitted at release) | Open | Requires: promote statuses to `verified`, add `subject_bindings` (hashed source/artifacts per requirement), close the concurrency and observability waivers with real characterization work, resolve the deployment-scoped classification waiver |

## Remaining adoption work

- Level 3 (release):
  - **Concurrency**: characterize `build-index`/`query-index` under concurrent access (currently zero coverage — real gap, not just unmodeled).
  - **Observability**: either add a logging/metrics/tracing hook for embedders, or make a documented decision that none is needed for a browser-only static-index client, and record that decision as the resolution rather than leaving the requirement open indefinitely.
  - **`subject_bindings`**: bind each requirement's contract version to its reviewed source revision and hashed artifacts (`Spec.subject_bindings`), per `EV-04`/`REF-14`.
  - **Status promotion**: move `system`/capabilities/components/requirements from `specified` to `verified` once their evidence is current and bound.
  - **`doc-store-shard` classification**: deployment-scoped, may never fully close for a general-purpose library — see Level 1's note; still a question worth raising with the toolkit maintainer.
- No model gaps found worth reporting as toolkit feedback this round beyond what Level 1 already noted.
