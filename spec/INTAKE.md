# Brownfield intake and gate record — Level 3 (Release)

Copied from [`system-spec/templates/BROWNFIELD-INTAKE.md`](../system-spec/templates/BROWNFIELD-INTAKE.md).
Level 0/1/2 history is preserved below (see PRs #167, #168, #169); this
update advances to Level 3 (`release`), the final brownfield adoption
level in this toolkit.

## Scope and authority

| Record | Observed value |
|---|---|
| Repository / source revision | `ktjn/searchable`. Level 0 baseline `cfbe583d5fec1381852df956cab0449339a9d39e` (merged #167); this update built on top of Level 2 (#169, `c7eb0fa`) |
| Adoption scope | Whole product, coarse component/capability boundaries. Excluded/deferred: `showcase/` (docs/demo site), `tools/fixtures`, `tools/relevance` (dev tooling, not a deployable unit) — unchanged from Level 0 |
| Existing authorities | `README.md`, `docs/reference/python-client-api.md`, `CLAUDE.md` (two-client-implementation policy); `spec/schema/*.schema.json` (authoritative index-format schemas); these remain authoritative over this spec |
| Tool map | Product gate is `scripts/gate.sh` (`pnpm gate`). `system-spec` validates `spec/system.yaml` only; it does not replace or subsume the product gate |
| Validator / schema pin | `system-spec-ref` 0.2.0 (PyPI wheel), exported snapshot committed at `system-spec/` |
| Native gates | `pnpm gate` (local, required before push via `.githooks/pre-push`); CI runs lint/build/typecheck/`uv build` plus spec validation, now at `--stage release` |
| Ownership | Author: this onboarding work. Acceptance owner: repo maintainer (`ktjn`) |

## Boundaries and dependencies

Unchanged from Level 1/2 — see those records below. No new units, providers
or consumers were discovered during Level 3 work.

## Data and evidence

- **Concurrency** (previously waived via `risk-concurrency-coverage`): closed with real new characterization tests, not by asserting the waiver away. Added `packages/searchable/test/concurrency.test.ts` and `python/searchable/tests/test_concurrency.py`, each firing many concurrent `query-index` calls (including a broad query racing many narrow ones) against one shared client instance and asserting no cross-contamination through the shared shard cache. Both suites run and pass at revision `4012bf86b14ebaaeaeec5e85c361845d88483091`. `req-concurrency`'s evidence — and every other `query-index`-targeted requirement's evidence, which shares that one subject — was re-run at this same revision (nothing in `python-client`/`ts-client` itself changed; this re-confirms, not fabricates, continued passing) so a single `subject_bindings` entry for `query-index` can honestly bind one revision. `risk-concurrency-coverage` is removed; no risk replaces it.
- **Observability** (previously waived via `risk-observability-coverage`): resolved as an explicit, documented acceptance rather than left open or default-closed unilaterally — this was put to Tommy as a decision (accept the gap vs. add instrumentation) since it's a product-scope call, not an onboarding-modeling call. Grounded in observed code: both `python-client` (`InvalidManifestError` in `validate_manifest.py`) and `ts-client` (`InvalidManifestError` in `validate-manifest.ts`) raise typed errors synchronously at the embedder's own call site for every build/query failure mode already modeled (`invalid-config`, `invalid-manifest`) — that synchronous-exception surface *is* the library's observability story; a separate logging/metrics/tracing channel isn't needed because there's no background operation for one to report on. Recorded as `Evidence` (`method: inspection`, not a waiver) rather than invented test coverage. `risk-observability-coverage` is removed.
- **`subject_bindings`** (`EV-04`/`REF-14`): added for every requirement subject referenced by evidence — `analyze-text`, `build-index`, `ts-client` (each bound at `abd6e1111b0ab212f5fac095ae9febaca31d14ae`, unchanged since Level 2) and `query-index`/`searchable` (bound at `4012bf86b14ebaaeaeec5e85c361845d88483091`, this update). Each binding's `artifacts` hash a real representative implementation source file (verified via `system-spec --check-artifacts --root .`), not an invented or aggregate path.
- **`classify-stored-document-fields`** (the one open Level 1 waiver, `doc-store-shard` field classification): still open — this library genuinely cannot produce that evidence itself, since classification depends on each embedding deployment's own stored content, not on this library's code. Rather than leave it an indefinitely-expiring risk (which `RISK-08` forbids at release) or fabricate evidence, it's marked `mandatory: false` with its criteria text explaining why: it's a requirement this repo tracks and documents, but can only ever be *satisfied* by each downstream deployment at that deployment's own onboarding. This is a modeling decision worth raising with the toolkit maintainer (see Level 1's note) — a "deployment-scoped, structurally unsatisfiable-here" requirement doesn't have a dedicated first-class representation.
- **Status promotion** (`STAT-04`): `system`, all 3 capabilities, all 4 components and all 12 requirements promoted from `specified` to `verified` — every one now has current, bound evidence (or is non-mandatory with a documented reason, for the one exception above).
- `system-spec spec/system.yaml --stage release` → `VALID`. `--check-artifacts --root .` → `VALID`.

### Known tool limitation: `--check-drift` false positives

Unchanged from Level 1/2: `--check-drift --root .` flags `term-shard`, `doc-store-shard` and `pins-shard` ("has no top-level properties") because those three JSON Schemas are keyed maps (`propertyNames` + `additionalProperties`), not a fixed `properties` object — the checker only diffs top-level `properties` and can't represent a dynamic-key map. CI runs this check as informational (`continue-on-error`).

## Gate decision and feedback

| Gate / precise scope | Observed evidence and skips | Pass, rework or scoped waiver | Remaining obligation, owner and expiry |
|---|---|---|---|
| Inventory | See Level 0 record in PR #167 history | **Pass** (unchanged) | — |
| Architecture | See Level 1 record in PR #168 history | **Pass** (unchanged) | `doc-store-shard` classification now resolved as non-mandatory (see above) rather than an open waiver |
| Verification | See Level 2 record in PR #169 history | **Pass** (unchanged) | Both verification-category waivers closed this level |
| Release | `system-spec spec/system.yaml --stage release` → `VALID`; `--check-artifacts --root .` → `VALID`. All statuses `verified`, all requirement subjects have bound `subject_bindings`, zero `risks` remain | **Pass** | None — Level 3 is complete |

## Remaining adoption work

- No open brownfield adoption work remains at this time. The one long-lived
  caveat (`doc-store-shard` field classification) is structural to a
  general-purpose library, not a gap in this onboarding; it's documented
  above and worth raising with the toolkit maintainer as model feedback
  (a first-class "satisfiable only by a downstream deployment" requirement
  kind), not something this repo can close further on its own.
- Future work should re-run `system-spec spec/system.yaml --stage release`
  whenever a capability, component or requirement's contract changes, and
  refresh the affected `subject_bindings`/evidence at that point — the
  same discipline applied in this update.
