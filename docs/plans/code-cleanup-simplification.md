# Code Cleanup and Simplification Plan

Status: Active. Progress is tracked in the [tracking ledger](#tracking-ledger)
at the bottom of this document.

**Goal:** Reduce duplication, dead code, and incidental complexity across the
monorepo without changing any runtime behavior, index format, or public API
contract, so that the codebase is easier to navigate, cheaper to test, and
harder to silently break.

**Scope:** All TypeScript workspaces under `packages/`, the `showcase/`
workspace, and root configuration. Python packages are out of scope except
where a TypeScript-side change would invalidate a documented mirror (the
binary format), which this plan deliberately avoids in early phases.

**Tech Stack:** Node.js 24, TypeScript 7, pnpm 11 (workspaces + catalogs),
Vitest 4, Biome.

## Global constraints

- No behavior change in Phases 1–5. Every phase ends green:
  `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck`.
- No index-format change. The binary shard layout stays bit-for-bit identical
  until Phase 6, and Phase 6 keeps the Python mirror in the same commit or
  explicitly defers it.
- No public API removal from published-target packages (`client`, `indexer`,
  `analysis`, `format`) without being flagged in the PR description.
  `relevance`, `benchmark`, and `fixtures` are private and freely trimmable.
- One phase per PR, split further as noted. Phases are independent and can be
  cherry-picked or reordered.
- Cross-implementation conformance tests are the safety net for anything
  touching hashing, canonicalization, or the binary format; they must pass
  unchanged.

## Background: what the audit found

Three independent sweeps (duplication, complexity hotspots, config/exports)
found the repo is structurally healthy but has accumulated:

- **Encoder/decoder mirror pairs** for every binary shard (indexer writes,
  client reads, Python ports) where a format change is a 3-way hand edit.
- **A `canonicalize` divergence**: `indexer/write-index.ts` sorts keys
  code-unit, `benchmark/workload.ts` uses `localeCompare` — different hashes
  for non-ASCII keys.
- **Five static file servers**, three of which share a byte-identical
  `discoverFiles` walker, one carrying a comment admitting the duplication.
- **A copy-pasted validation kit**: the `record()` helper in six files,
  `UnknownRecord` declared five times in `relevance` alone.
- **Two monoliths**: `client/src/search.ts` (1601 lines) and
  `indexer/src/build-index.ts` (814 lines), both with clean internal seams.
- **Config and script sprawl**: `pnpm build` triggered from 12 root scripts
  (CI builds packages 4× per job), three byte-identical no-op vitest configs,
  byte-identical tsconfig pairs.
- **Dead code**: a fully unimported `relevance` barrel, an unused
  `@vitest/coverage-v8` devDep, broken `test` scripts in `format`/`fixtures`,
  and a literal NUL byte in `client/src/validate-manifest.ts`.

---

## Phase 1 — Pure deletion

Zero risk. Nothing removed is reachable from any consumer.

- [ ] **1.1** Delete `packages/relevance/src/index.ts` (73-line barrel with
  zero importers; its own 18 test files bypass it) and remove the
  `main`/`types`/`exports` fields from `packages/relevance/package.json`.
- [ ] **1.2** Remove the unused root `@vitest/coverage-v8` devDependency (no
  `--coverage` flag, coverage config, or CI reference exists).
- [ ] **1.3** Remove the broken `test` script + `vitest` devDependency from
  `packages/format/package.json` (zero tests; script crashes on the root
  projects config) and the broken `test` script from
  `packages/fixtures/package.json` (tests already run via root project
  discovery).
- [ ] **1.4** Narrow over-public exports to module-private:
  `normalizePageId` (relevance `domain-runner`), `isZeroResult` (relevance
  `metrics`), `DEFAULT_RRF_K` (client barrel; referenced by nothing),
  `TOPICS` (fixtures; no importer anywhere).
- [ ] **1.5** Move `typescript` (identical `^7.0.2` pin in 8 package.json
  files) into the pnpm catalog, following the established
  `@playwright/test` catalog pattern.

Verify: `pnpm build && pnpm test && pnpm lint`.

## Phase 2 — Deduplication

- [ ] **2.1 Fix the `canonicalize` divergence first.** Unify on code-unit key
  ordering in one shared function (home: `@ktjn/searchable-format`, which
  both sides already depend on) and delete the `benchmark/workload.ts` copy.
  Different orderings produce different SHA-256 hashes for non-ASCII keys;
  this is a latent correctness bug, not just duplication.
- [ ] **2.2 Static servers ×5 → 1.** Extract
  `serveDirectory(root, { contentTypes?, cors?, onRequest? })` into
  `@ktjn/searchable-fixtures` (already a devDependency of client). Collapse
  the three `discoverFiles`-family copies (`client/test/static-server.ts`,
  `client/e2e-browser/serve-dir.ts`, `showcase/e2e-browser/serve-dir.ts`) and
  adopt it in `relevance/static-server.ts`. Benchmark's dual-root server
  keeps its socket tracking but reuses the traversal/content-type core.
  Dedupe the two traversal-security test copies to match.
- [ ] **2.3 Validation kit ×6 → 1.** One `validation.ts` in `relevance`
  (throwing `record`, errors-collecting `record`, `nonBlank`, `httpUrl`,
  `isoDate`, `string`, `array`, `UnknownRecord`), shared with
  `benchmark/report.ts`. Removes ~150 lines across govuk-normalize,
  govuk-refresh, domain-runner, validate-suite, validate-domain-suite, and
  benchmark's `validateReport`.
- [ ] **2.4 Transformers constants.** Move `DEFAULT_TRANSFORMERS_MODEL`
  (currently drift-guarded only by a keep-in-sync comment) and the
  `TransformersDtype` union to `@ktjn/searchable-format`. Keep the
  deliberately different loading strategies (indexer eager, client lazy).
- [ ] **2.5 Mechanical small fry:** `escapeHtml` ×4 → 1; merge
  `writeJson`/`writeBinary` in `write-index.ts` into one `writeHashed`;
  collapse the four per-language shard sections in `writeIndex` into one
  loop; merge `fetchJson`/`fetchArrayBuffer` into `#fetchCached(url,
  decode)`; single `resolve()` in client; concept-bucket test embedder ×5 →
  one copy in fixtures plus a single JS copy inside `harness.html` (it is
  pasted twice into that one file today).

Verify: build + test + lint per commit; conformance tests guard 2.1.

## Phase 3 — Config and test hygiene

- [ ] **3.1 Collapse pre-hook sprawl.** Replace `pre*` scripts with explicit
  composition (`"benchmark:smoke": "pnpm build && pnpm --filter … smoke"`),
  unify the two existing styles, and merge the `bench`/`benchmark:*` naming
  overlap. Target: CI stops building packages 4× per job
  (typecheck/size/test/test:browser each trigger a full `pnpm -r build`
  today).
- [ ] **3.2 Delete the three byte-identical no-op vitest configs**
  (`analysis`, `indexer`, `relevance` — each only sets vitest's default
  environment) by standardizing on benchmark's
  `vitest run --root ../.. --project <name>` invocation pattern.
- [ ] **3.3 tsconfig dedup.** Add an intermediate `tsconfig.package.json`
  (outDir/rootDir/verbatimModuleSyntax) so the byte-identical pairs
  (relevance=benchmark, format=fixtures) become 3-line files.
- [ ] **3.4 Fixture-policy tests ×5 → one parameterized test** over
  `{suiteId, language, topics, minDocs, minQueries}`. Removes the `as never`
  casts that exist only because `KnownDomainSuite` lags committed fixtures.
- [ ] **3.5 Rename `benchmark/vitest.browser.config.ts`** — it runs
  `environment: "node"` and drives Playwright manually; the current name
  implies vitest browser mode.

## Phase 4 — Split the monoliths

Behavior-preserving moves only; no logic edits beyond moving code.

- [ ] **4.1 `client/src/search.ts` (1601 lines).** Extract along existing
  seams: `fuzzy.ts` (levenshtein, candidates, `loadFuzzyLookup`),
  `synonyms.ts`, `facets.ts`, `hybrid.ts`; then decompose the ~510-line
  `lexicalSearch` into clause resolution → phrase resolution →
  intersection/filters → scoring → pins → assembly.
- [ ] **4.2 `indexer/src/build-index.ts` (814 lines).** Extract `facets.ts`
  (~185 lines: both range-bucket strategies, hierarchy expansion),
  `synonyms.ts`, `fuzzy.ts`, `pins.ts`, `postings.ts`. Replace the four
  hand-written Map get-or-create copies with a Map variant of the analysis
  package's `getOrCreate`.
- [ ] **4.3 `indexer/src/write-index.ts` (502 lines).** Extract
  `canonicalize.ts` (shared per 2.1) and `term-shard-split.ts` (the
  gzip-budget recursion cluster).
- [ ] **4.4 `relevance/govuk-normalize.ts`.** Extract generic
  `html-to-text.ts` and `snapshot-hash.ts` — the hash is already imported
  cross-suite from a govuk-named file, a pure misplacement.
- [ ] **4.5 `client.ts` guard preamble ×3 → one `#assertUsable(signal)`.**

## Phase 5 — De-engineer ceremony

- [ ] **5.1** Collapse `benchmark/render.ts` `promoteAndRender` (~110 lines
  of staging/backup/rollback to write two local files) to the existing
  20-line `writeReportAtomic` pattern.
- [ ] **5.2** Slim DI surfaces: `RunBenchmarkDependencies` 13 fields → ~4
  real seams (`measureBrowser`, `serveBenchmark`, `createWorkload`,
  `captureGitState`); govuk-refresh's six flat fs knobs → one `io` object,
  matching the io-pattern used elsewhere in the same packages.
- [ ] **5.3** Resolve the `resolvePins` warnings indirection: either emit
  warnings inside or return them on `BuiltIndex` (today they are returned
  and the only consumer `console.warn`s them).
- [ ] **5.4** One shared atomic-write helper replacing the three
  implementations (govuk-refresh inline, benchmark report, benchmark
  render).
- [ ] **5.5** Twin CLI entries → one CLI with a subcommand each (benchmark
  `cli.ts`/`render-cli.ts`, relevance `cli.ts`/`refresh-cli.ts`, both pairs
  sharing verbatim entry boilerplate).
- [ ] **5.6** Decide the fate of the vestigial top-level `Manifest.format`
  field (buildIndex always emits `"json"`; the per-shard flag is the
  operative signal).
- [ ] **5.7** Replace the literal NUL byte in
  `client/src/validate-manifest.ts` with the `"\0"` escape (some tools treat
  the file as binary today).

## Phase 6 — Structural (separate PRs, separate decisions)

- [ ] **6.1 Single home for the binary format.** Move the codec into
  `packages/format` (revising its "no runtime logic" charter) with
  `encodeX`/`decodeX` colocated per shard type. The client bundle stays
  clean via tree-shaking. The Python mirror moves or is re-pointed in the
  same PR. This converts the biggest drift risk in the repo — a format
  change as a 3-way hand edit — into a single definition.
- [ ] **6.2 Unify relevance v1/v2 frameworks.** v2 domain suites are already
  converted to v1 for evaluation, so v1 (`validate-suite.ts`, `schema.ts`,
  six baseline fixtures) is a strict subset and can be migrated to v2
  snapshot corpora, deleting one whole framework (~200+ lines) and one
  mental model. Requires a one-time fixture migration.

---

## Execution plan

| Round | Contents | PR(s) |
|---|---|---|
| A | Phase 1 + items 2.1, 2.3, 5.7 | One PR: deletion + latent hash-divergence fix |
| B | Rest of Phase 2 + Phase 3 | One PR: dedup + CI speedup |
| C | Phase 4 + Phase 5 | Package-by-package PRs |
| D | Phase 6 | Standalone PRs with their own design discussion |

## Tracking ledger

| Item | Description | Status | PR | Notes |
|---|---|---|---|---|
| 1.1 | Delete dead relevance barrel + package.json exports | done | docs/cleanup-plan | |
| 1.2 | Remove unused `@vitest/coverage-v8` | done | docs/cleanup-plan | |
| 1.3 | Remove broken format/fixtures test scripts | done | docs/cleanup-plan | fixtures keeps vitest devDep (tests run via root) |
| 1.4 | Narrow over-public exports to module-private | done | docs/cleanup-plan | normalizePageId/DEFAULT_RRF_K/TOPICS narrowed; isZeroResult retained (direct test consumer) |
| 1.5 | Move `typescript` pin to pnpm catalog | done | docs/cleanup-plan | |
| 2.1 | Unify `canonicalize` (code-unit order), fix hash divergence | done | docs/cleanup-plan | moved to `@ktjn/searchable-format`; benchmark baseline hash unchanged (ASCII keys) |
| 2.2 | One shared static server in fixtures | pending | | |
| 2.3 | One validation kit (relevance + benchmark) | done | chore/validation-kit | relevance only: shared `validation.ts` (errors-collecting `record`/`nonBlank`/`httpUrl`/`isoDate` + throwing `expectRecord`/`expectArray`/`expectString`); 5 relevance copies removed. Benchmark deferred — its `string`/`finite`/`positiveInteger`/`sha256` are single-site and benchmark-specific, so a cross-package dependency wasn't worth it |
| 2.4 | Share transformers constants via format | done | chore/cleanup-round-b | `DEFAULT_TRANSFORMERS_MODEL` + `TransformersDtype` moved to `@ktjn/searchable-format`; both packages import and re-export. Loading strategies unchanged |
| 2.5 | Mechanical small-fry dedupes | in-progress | chore/cleanup-round-b | showcase `escapeHtml` deduped within showcase (docs-site imports gallery-shared). `resolve()` ×2 deferred (module-private 3-liners; sharing adds coupling for ~3 lines). `writeJson`/`writeBinary` + per-language shard loop + `#fetchCached` deferred to a focused production-path PR. concept-bucket embedder ×5 deferred (test-only; harness.html needs a plain-JS copy) |
| 3.1 | Collapse pre-hook sprawl, cut CI rebuilds | pending | | CI builds 4× today |
| 3.2 | Delete no-op vitest configs | pending | | deferred: requires switching `--filter` test scripts to the benchmark `--root ../.. --project` pattern too, else deleting the no-op config breaks package-local vitest runs (walks up to root projects config). Fiddly vitest workspace resolution — defer to a dedicated PR |
| 3.3 | Intermediate tsconfig base | dropped | | `rootDir`/`outDir`/`include` resolve relative to the config that defines them, so a shared `tsconfig.package.json` at repo root would point every package at `../../src`. Only `lib`/`types`/`verbatimModuleSyntax` could be shared, and those already differ per package — no real collapse available |
| 3.4 | Parameterize fixture-policy tests | done | chore/cleanup-phase3-test-hygiene | extracted shared `assertSnapshotSuitePolicy` helper; de-fahrerlaubnisrecht + gutenberg now call it (gutenberg keeps its filter-consistency block). govuk/domain-fixture-policy/fixture-policy stay — they pin exact provenance/counts/kind and aren't shape-compatible with the snapshot core. Also dropped the stale `as never` casts in de/govuk/gutenberg (KNOWN_DOMAIN_SUITES already lists them; searchable-docs never had the cast) |
| 3.5 | Rename misleading browser config | done | chore/cleanup-phase3-test-hygiene | `vitest.browser.config.ts` → `vitest.playwright.config.ts` (runs under `environment: "node"` driving Playwright's chromium, not vitest browser mode). Updated the benchmark `test:browser` script and the `pages-workflow-policy` test that pins the name |
| 4.1 | Split `client/src/search.ts` | pending | | |
| 4.2 | Split `indexer/src/build-index.ts` | pending | | |
| 4.3 | Split `indexer/src/write-index.ts` | pending | | |
| 4.4 | Extract html-to-text / snapshot-hash | pending | | |
| 4.5 | `#assertUsable` in client.ts | pending | | |
| 5.1 | Collapse promoteAndRender transaction | pending | | |
| 5.2 | Slim DI surfaces | pending | | |
| 5.3 | Resolve resolvePins warnings indirection | pending | | |
| 5.4 | One atomic-write helper | pending | | |
| 5.5 | Single CLI per package with subcommands | pending | | |
| 5.6 | Decide `Manifest.format` fate | pending | | |
| 5.7 | Replace literal NUL byte with escape | done | docs/cleanup-plan | validate-manifest.ts now `\0` escape; runtime NUL separator preserved |
| 6.1 | Binary format single home in `format` | pending | | separate decision |
| 6.2 | Unify relevance v1/v2 frameworks | pending | | fixture migration |

### Ledger conventions

- Status values: `pending`, `in-progress`, `done`, `dropped`.
- When starting an item, set `in-progress` and note the branch in Notes.
- When merging, set `done` and link the PR.
- If an item is rejected during review, set `dropped` and record why.
- Archive this file to `docs/archive/plans/code-cleanup-simplification.md`
  when every row is `done` or `dropped`.
