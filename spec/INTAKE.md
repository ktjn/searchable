# Brownfield intake and gate record — Level 0 (Inventory)

Copied from [`system-spec/templates/BROWNFIELD-INTAKE.md`](../system-spec/templates/BROWNFIELD-INTAKE.md).
Covers only the Level 0 (`inventory`) gate; later levels are future work.

## Scope and authority

| Record | Observed value |
|---|---|
| Repository / source revision | `ktjn/searchable` at `cfbe583d5fec1381852df956cab0449339a9d39e` (clean checkout) |
| Adoption scope | Whole product, coarse boundaries only. Excluded/deferred: `showcase/` (docs/demo site), `tools/fixtures`, `tools/relevance` (dev tooling, not a deployable unit) |
| Existing authorities | `README.md`, `docs/reference/python-client-api.md`, `CLAUDE.md` (two-client-implementation policy); these remain authoritative over this spec |
| Tool map | Product gate is `scripts/gate.sh` (`pnpm gate`: biome, ruff/mypy/pytest, build, typecheck, bundle size, vitest, Playwright). `system-spec` validates `spec/system.yaml` only; it does not replace or subsume the product gate |
| Validator / schema pin | `system-spec-ref` 0.2.0 (PyPI wheel), exported snapshot committed at `system-spec/` |
| Native gates | `pnpm gate` (local, required before push via `.githooks/pre-push`); CI (`.github/workflows/`) runs lint/build/typecheck/`uv build` only |
| Ownership | Author: this onboarding PR. Acceptance owner: repo maintainer (`ktjn`). No remediation owner assigned yet — no waivers recorded at this level |

## Boundaries and dependencies

| Unit / entrypoint | Internal, external, deferred or unknown | Observed provider / consumer / state owner | Evidence / unresolved mapping |
|---|---|---|---|
| `python-indexer` (`python/searchable/src/searchable/indexer`, `.../analysis`) | Internal | Builds the JSON index shards consumed by both clients; owns no runtime state | `pyproject.toml` entry point `searchable = "searchable.cli:main"` |
| `python-client` (`python/searchable/src/searchable/client`) | Internal | Queries a built index at runtime (CLI/backend use) | Same package, separate module; no shared mutable state with the indexer |
| `ts-client` (`packages/searchable/src`) | Internal | Queries a built index at runtime (browser use) | Published to GitHub Packages as `@ktjn/searchable` |
| GitHub Packages / PyPI registries | External, deferred | Publish-time only (`publish.yml` workflow); not exercised by inventory | Out of scope for Level 0; revisit at architecture level if release automation needs modeling |
| `showcase/` app | Excluded | Consumes `ts-client` and the Python builder for docs/demo generation; not a shipped product component | Deliberately left out of `components`; revisit if it needs its own contract |

No `external_sources` are registered: the library builds and searches a static index with no third-party runtime dependency (no query-time server, no hosted API — see `README.md` "Why Searchable"). GitHub Packages/PyPI are publish-time distribution channels, not runtime dependencies, so they are not modeled as `external_sources` either.

No `requires`/`provides` wiring is recorded yet — components are coarse, draft-status stubs only (`capabilities: []`), per the Level 0 goal ("identity and syntax only").

## Data and evidence

Not applicable at Level 0 — no `data_models` or `Evidence` are declared. The shared index format (JSON shards/manifest) is documented in `docs/reference/python-client-api.md` and `spec/fixtures/`; data-model extraction is deferred to Level 1.

## Gate decision and feedback

| Gate / precise scope | Observed evidence and skips | Pass, rework or scoped waiver | Remaining obligation, owner and expiry |
|---|---|---|---|
| Inventory | `system-spec spec/system.yaml --stage inventory` → `VALID`; `--check-artifacts --root .` → `VALID`; `--check-drift --root .` → `VALID` | **Pass** | None at this level. No waivers recorded. |
| Architecture | Not attempted | Open | Requires: `provides`/`requires` wiring for the shared index-format contract (`client-conformance.test.ts` cases), data model for the index manifest/shard format, resolution of the showcase boundary if it is brought in scope |

No model gaps or self-improvement feedback to report from this onboarding.
