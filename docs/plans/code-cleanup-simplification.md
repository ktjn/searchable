# Code Cleanup and Simplification Plan

Status: Active. Progress is tracked in the [tracking ledger](#tracking-ledger)
at the bottom of this document.

Refreshed 2026-08-05 (Step 0): scope re-set to the actual architecture
(Python-only index generation; TS + Python search clients), parity work added,
and all items that referenced the deleted TypeScript indexer/benchmark marked
dropped. Historical rows below retain their original keys.

**Goal:** Reduce duplication, dead code, and incidental complexity across the
monorepo — and keep the two search clients behaviorally aligned — without
changing the index format or public API contracts, so the codebase is easier
to navigate, cheaper to test, and harder to silently break.

**Architecture context (drives everything in this plan):**

- Static index generation is **Python-only**:
  `python/searchable-indexer` (+ shared `python/searchable-analysis`). The
  TypeScript indexer and benchmark were deliberately removed in commit
  `90c5431` (#61); only untracked `dist/`/`node_modules/` shells remain in
  `packages/indexer` and `packages/benchmark`.
- Search runtimes are **dual TS + Python**:
  - TS: `packages/analysis`, `packages/format`, `packages/client`
  - Python: `python/searchable-analysis`, `python/searchable-client`
- Cross-language code cannot be shared. The shared contracts are: the binary
  format docs, `spec/schema/*.json`, the cross-implementation conformance
  tests, and **mirrored module structure** between the two clients (the plan
  names seams identically: `fuzzy`, `facets`, `hybrid`, `phrase`).
- Python analysis feeds both the indexer (index-time) and the Python client
  (query-time); TS analysis feeds only the TS client (query-time).

**Scope:** All TypeScript workspaces under `packages/` (`analysis`, `client`,
`format`, `fixtures`, `relevance`), the `showcase/` workspace, root
configuration, AND the three Python packages (`searchable-analysis`,
`searchable-client`, `searchable-indexer`), including deliberate
behavior-alignment of the Python client to the TS client (Phase B). Excluded by
design: `spec/examples/python/generate_index.py` and
`python/searchable-client/tests/fixtures/build_index.py` — the architecture-
mandated independent reference copies that governance requires stay unshared
(`spec/examples/README.md`, `test_cross_implementation_conformance.py`).

**Tech Stack:** Node.js 24, TypeScript 7, pnpm 11 (workspaces + catalogs),
Vitest 4, Biome; Python 3.10+, uv, Ruff, mypy, pytest.

## Global constraints

- No index-format change. The binary shard layout stays bit-for-bit identical.
- **No behavior change except Phase B parity fixes**, each of which lands with
  a cross-implementation conformance test in the same commit. Phase B aligns
  Python to TS; divergence direction is TS-as-reference.
- No public API removal from published-target packages (`analysis`, `client`,
  `format`; Python analysis/indexer client API) without flagging in the PR
  description. `relevance`, `fixtures`, and showcase are private and freely
  trimmable.
- One phase per PR. Phases are independent and can be cherry-picked.
- Cross-implementation conformance tests guard anything touching hashing,
  canonicalization, or the binary format; they must pass unchanged.
- Windows CRLF note (AGENTS.md): `biome check` reports spurious whole-file
  diffs on local checkouts; use `git diff` after `--write` to confirm real
  changes before assuming a red run.
- Python gates (AGENTS.md, mandatory): `uv sync`, `uv run ruff check .`,
  `uv run ruff format --check .`, `uv run mypy src`, `uv run pytest -v`.

## Background: current audit state (2026-08-05)

- **Monoliths:** `packages/client/src/search.ts` (1,544), Python client
  `search.py` (790), Python indexer `build_index.py` (604),
  `packages/analysis/src/language-profile.ts` (718 — ~590 lines are stopword
  data), test fixture `python/searchable-client/tests/fixtures/build_index.py`
  (1,134).
- **Dead artifacts:** `packages/benchmark/` + `packages/indexer/` (untracked
  shells); TS analysis `getOrCreate` (zero callers); Python
  `build_index.py:540` unused `vector_definition`; empty
  `searchable_indexer/__init__.py`; no `py.typed` in any Python package;
  `python/searchable-client` has no `.gitignore`.
- **Python↔TS behavioral drift (identified, not yet fixed):** multi-word
  phrase-synonyms never consumed by Python client; hybrid fusion drops pinned
  hits and uses a different candidate floor; raw `search()` raises where TS
  returns empty; fuzzy-cap truncation is silent in Python.
- **Triplication:** `python-index.ts` ×3 (`relevance/src`, `client/test-support`,
  `showcase`), static file servers ×2 remaining, binary-format knowledge ×3
  in Python (indexer writer / client reader / test fixture).
- **Config/CI:** root `vitest.config.ts` glob `"packages/*"` sweeps the orphan
  shells; `pre*` scripts make CI build packages 4× per job; `uv sync` step
  copy-pasted in 3 workflows; analysis/indexer lack ruff+mypy gates entirely.

---

## Phase 0 — Refresh this plan (this step)

- [x] **0.1** Re-scope to Python-only generator + dual clients; add parity
  phase; mark deleted-indexer references dropped; extend the ledger.

## Phase A — Pure deletion & hygiene (zero behavior risk)

- [x] **A.1** Delete the untracked orphan shells `packages/benchmark/` and
  `packages/indexer/` (`dist/` + `node_modules/`; broken symlink trees), then
  fix the root `vitest.config.ts` `projects` glob `"packages/*"` to the
  explicit list `["packages/analysis","packages/client","packages/fixtures",
  "packages/format","packages/relevance"]`.
- [x] **A.2** Add `python/searchable-client/.gitignore` mirroring its siblings
  (`.venv/`, `.pytest_cache/`, `__pycache__/`, `*.pyc`, `uv.lock`); root
  `.gitignore`: add `.agents/`, `.artifacts/`, `.codex/`, `.junie/`; delete the
  never-tracked stale `.junie/` plan (Renovate already shipped) and empty
  `.claude/worktrees/`, `.worktrees/`.
- [x] **A.3** Deletions in Python: `build_index.py:540` dead
  `vector_definition = None` (F841, unfixed because analysis/indexer are not
  ruff-gated); duplicate Dutch stopword `"ik"` (`language_profile.py:84`,
  B033); re-sort `searchable_analysis/__init__.py` imports (`I001`) and
  `__all__` (`RUF022`).
- [x] **A.4** Add `[tool.ruff]` + `[tool.mypy]` to `searchable-analysis` and
  `searchable-indexer` pyproject mirroring the client's
  (`client/pyproject.toml:26-36`, ruff `E,F,I,UP,B`, mypy strict), and run
  those gates in the analysis/indexer CI jobs (`ci.yml:29-38`) the same way the
  client job does (`ci.yml:39-46`). Fix the then-visible autofixables
  (UP035 `typing`→`collections.abc`, UP007 `Union`→`|`, PIE810, FURB136,
  FURB188, SIM118). Note: mypy strict on the indexer required annotation
  cleanup across 12 modules (all `dict[..]`/def annotations + 2 genuine type
  bugs) to reach green.
- [x] **A.5** Ship `py.typed` in all three Python packages (hatchling includes
  package-dir files); remove the `# type: ignore[import-untyped]` comments in
  `searchable_client/search.py:6-10` and `parse_query.py:4`; give
  `searchable_indexer/__init__.py` a real `__all__` modeled on the old TS
  barrel (`packages/indexer/dist/index.d.ts`): `build_index`,
  `build_vector_shards`, `chunk_text`, `discover_html_documents`,
  `extract_document`, `write_index`, plus the type names.
- [x] **A.6** Prune TS analysis to post-indexer reality: delete `getOrCreate`
  (`analysis/src/index.ts:26`, zero callers incl. tests); keep
  `detectLanguage`/`getRegisteredLanguageCodes` (test-callers; coherent
  analysis library) but fix the stale doc comments and package.json description
  that still cite a TS indexer (`safe-dict.ts:17`, `detect-language.ts:4-6`).
- [ ] **A.7** Indexer error conventions: drop the redundant
  `"build_index_documents:"`/`"build_index:"` message prefixes (done) — but the
  `ValueError`→`TypeError` switch for pure-type checks is **deferred**: ruff's
  configured rule set (`E,F,I,UP,B`) does not include TRY004, and 53 test
  assertions pin `pytest.raises(ValueError)`, making it a behavior-changing
  exception-API edit that belongs in its own PR.

Verify: `pnpm build && pnpm lint && npx vitest run <affected>`; Python:
`uv sync && uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run pytest -v`.

## Phase B — Python↔TS client parity (behavior-alignment; conformance-guarded)

Reference: TS `packages/client/src/search.ts`; target: Python
`searchable_client/search.py`. Each item lands with a conformance test.

- [x] **B.1** Multi-word phrase-synonyms. TS expands quoted phrases via
  `multiWordVariantsFor` (`search.ts:428-441, 888-960`); Python parses the
  shard (`types.py:203,296`) but never consumes it (`search.py:660-688`).
  Port the expansion into the Python phrase path. Biggest divergence.
- [x] **B.2** Hybrid fusion pinned hits. Port `fuseHybridResult`
  (`search.ts:1364-1442`): carry pins through unchanged, exclude from
  RRF/weighted fusion, re-merge in front with `remainingSlots = max(0, limit -
  pinned.length)`; candidate floor `max(limit*3, 30)` to match `search.ts:1311`
  (Python `search.py:475` uses `max(limit*3, limit)`).
- [x] **B.3** Missing-vector-shard semantics: raw `search()` returns an empty
  result like TS (`search.ts:1303-1306`); keep the loud `VectorUnavailableError`
  only at `SearchClient` level (`search.py:383-384`).
- [x] **B.4** Fuzzy-cap truncation warning: match TS `console.warn`
  (`search.ts:522-526`); Python truncates silently at `MAX_FUZZY_CANDIDATES_PER_TERM`
  (`search.py:246`).
- [x] **B.5** Error-base standardization: `InvalidManifestError` subclasses
  `ValueError` alongside the vector errors (`errors.py:1-18`), and a single
  common public base for search errors.
- [x] **B.6** Indexer reuse: delete private `_generate_deletes`
  (`searchable_indexer/fuzzy.py:7-18`) and import the public
  `generate_deletes` from `searchable-analysis` (already a dependency,
  `indexer/pyproject.toml:7`).

Verify: Python gates + the Python and TS conformance suites
(`test_cross_implementation_conformance.py`, `cross-implementation-conformance.test.ts`).

## Phase C — Modularization (mirrored seams in both search clients)

- [x] **C.1** Split TS `packages/client/src/search.ts` (1,625) →
  `fuzzy.ts`, `facets.ts`, `hybrid.ts`, `phrase.ts` + `synonyms.ts`,
  `doc-store.ts`, `url.ts` (shared `resolve`), along the existing
  test-covered seams (levenshtein/`loadFuzzyLookup`; `fetchFacetShards`/
  `unionDocsForField`/filter helpers; `vectorHitsForLanguage`/`minMaxNormalize`/
  `fuseHybridResult`; `containsPhrase`/`hasConsecutivePositions`). No
  behavioral change; search.ts keeps the types + `lexicalSearch` + public
  entries.
- [x] **C.2** Split Python `search.py` (969) → mirrored `fuzzy.py`, `facets.py`,
  `hybrid.py`, `phrase.py`, `synonyms.py`, `doc_store.py`; result types
  (`Hit`/`SearchOptions`/`SearchResult`/facet types) moved to `types.py` with
  `search` re-exports + `__all__`; nested `class _BinaryFuzzyLookup` extracted
  to module level; `hybrid.py` reaches `search()` via a lazy import (avoids an
  import cycle); `_score_of`/`_to_hit` remain in `search()` as local closures
  (tightly coupled to that scope — extracted in the C.6 client.ts pass if kept).
- [x] **C.3** Split `packages/analysis/src/language-profile.ts` (743) — extract
  the ~550 lines of stopword datasets (`44-592`) into `stopwords.ts`;
  `language-profile.ts` now 203 lines.
- [x] **C.4** Split Python indexer `build_index.py` — extracted `_add_postings`
  into `postings.py` (`build_index.py` no longer builds postings inline) and
  de-parametrized `_build_prepared_documents`: the ~15 keyword knobs are now a
  single frozen `BuildConfig` dataclass.
- [x] **C.5** Dedupe small pairs as the split lands: `resolve()` (done — `sw.ts`
  onto `url.ts`); the three binary directory decoders now share
  `decodeDirectory` (TS `binary-directory.ts`) / `read_directory`
  (`byte_reader.ts`), with per-shard key readers for strings vs delta-encoded
  doc ids.
- [x] **C.6** Carry-over from old plan: extract `html-to-text` + `snapshot-hash`
  from `relevance/govuk-normalize.ts` (old 4.4, done); unify `#assertUsable`
  guard preamble in `packages/client/src/client.ts` (old 4.5, done); `resolvePins`
  warnings into `BuiltIndex` (old 5.3, done); relevance CLI entry bootstrap
  deduped via `cli-runner.ts` (old 5.5 — full subcommand merge deferred: changes
  the package's CLI surface, own PR); `Manifest.format` decided (old 5.6 —
  retained: it's part of the index-format spec; the per-shard `format` flag is
  the operative signal. Removing it is a format change, deferred to any future
  revision tracked under F.1).

## Phase D — Cross-package dedup (TS / showcase)

- [x] **D.1** De-triplicate `python-index.ts` (`relevance/src` ×109,
  `client/test-support` ×157 — superset, keep its `PythonStructuredDocument` +
  `embed` surface — `showcase` ×104) into `@ktjn/searchable-fixtures` (new
  `./python-index` subpath export); the three copies are one-line `export *`
  facades (same paths, zero import churn), repoRoot computed once from
  fixtures' own location. Kills the "keep in sync" drift.
- [x] **D.2** Static file server consolidation: `relevance/static-server.ts`
  deleted; `domain-runner.ts` + `searchable-runner.ts` now use fixtures'
  `serveDirectory` (they serve fully-built dirs, so the fixtures server's
  pre-discovery semantics are equivalent).
- [x] **D.3** Showcase: shared `buildGalleryDemo()` pipeline helper for
  `build-gallery.ts`, `build-gallery-synonyms.ts`, `build-gallery-i18n.ts`;
  `pageShell` now takes `meta?: string[]` / `lang?: string`, killing the
  string-splice hacks; `quick-examples.ts` uses `gallery-shared` `escapeHtml`.
- [x] **D.4** Merge the showcase directory walkers (`findHtmlFiles`,
  `listSiteFiles`) onto one `walk-files.ts` helper.

## Phase E — Config, CI, docs

- [ ] **E.1** Kill the 4× CI rebuild sprawl (old 3.1): replace root `pre*`
  scripts (`package.json:15,17,19,21`) with explicit composition so CI builds
  packages once.
- [ ] **E.2** Fold the triplicated `uv sync` step (`ci.yml:54-56,67-69`,
  `deploy-pages.yml:29-31`) into `.github/actions/setup-python/action.yml` with
  a `working-directory` input. Update `showcase/test/
  pages-workflow-policy.test.ts` in the same commit (it pins workflow text).
- [ ] **E.3** Revisit deleting no-op vitest configs (`analysis`, `relevance` —
  old 3.2, deferred for vitest workspace-resolution reasons; re-check whether
  the `--root ../.. --project` pattern now works, else mark dropped).
- [ ] **E.4** Resolve `docs/project/language-support.md` orphan: link it into
  `docs-nav.ts` Project section or consciously accept it.

## Phase F — Structural, separate decisions

- [ ] **F.1** (old 6.1) Single home for the binary-format codec. Re-examine in
  light of the Python-only indexer: the target is one encoder/decoder pair per
  language co-located per shard type, with the format spec as the arbiter —
  not necessarily a move into `packages/format`.
- [ ] **F.2** (old 6.2) Unify relevance v1/v2 frameworks (one-time fixture
  migration).

---

## Legacy scope disposition

Old plan items that no longer apply because the TS indexer/benchmark were
deleted (#61): 4.2 (split `indexer/build-index.ts`), 4.3 (split
`indexer/write-index.ts`), the 2.5 sub-items `writeJson`/`writeBinary` merge and
the per-language shard loop (both in the deleted `write-index.ts`),
2.2's benchmark dual-root server, 3.1's benchmark naming cleanup, 3.5 (benchmark
config rename — done, now moot), 5.1 (benchmark `promoteAndRender`), part of
5.2/5.4 (benchmark DI/atomic-write). All marked `dropped` in the ledger with
reasons. Old 4.1 survives as C.1, 2.2 as D.2, 3.1 as E.1, 3.2 as E.3, 4.4/4.5/
5.3/5.5/5.6 as C.6, 6.1/6.2 as F.1/F.2.

---

## Execution plan

| Round | Contents | PR(s) | Risk |
|---|---|---|---|
| 0 | Phase 0 (this doc refresh) | docs/cleanup-plan | none |
| 1 | Phase A (deletion + hygiene) | — | none — deletion/hygiene |
| 2 | Phase B (Python parity + conformance tests) | — | behavior change, test-guarded, Python-only |
| 3 | Phase C (mirrored monolith splits) | package-by-package | mechanical; conformance net |
| 4 | Phase D (TS/showcase dedup) | — | pages-workflow-policy coupling |
| 5 | Phase E (config/CI/docs) | — | config + workflow-text assertions |
| — | Phase F | standalone PRs | — |

## Tracking ledger

### Historical rows (keep as-is where done; update statuses)

| Item | Description | Status | PR | Notes |
|---|---|---|---|---|
| 1.1 | Delete dead relevance barrel + package.json exports | done | docs/cleanup-plan | |
| 1.2 | Remove unused `@vitest/coverage-v8` | done | docs/cleanup-plan | |
| 1.3 | Remove broken format/fixtures test scripts | done | docs/cleanup-plan | fixtures keeps vitest devDep (tests run via root) |
| 1.4 | Narrow over-public exports to module-private | done | docs/cleanup-plan | normalizePageId/DEFAULT_RRF_K/TOPICS narrowed; isZeroResult retained (direct test consumer) |
| 1.5 | Move `typescript` pin to pnpm catalog | done | docs/cleanup-plan | |
| 2.1 | Unify `canonicalize` (code-unit order), fix hash divergence | done | docs/cleanup-plan | moved to `@ktjn/searchable-format`; baseline hash unchanged (ASCII keys) |
| 2.2 | One shared static server in fixtures | rekeyed → D.2 | | benchmark copy gone; only `relevance/static-server.ts` remains |
| 2.3 | One validation kit (relevance + benchmark) | done | chore/validation-kit | relevance only; benchmark-specific helpers remained local — single-site, not worth a dependency |
| 2.4 | Share transformers constants via format | done | chore/cleanup-round-b | |
| 2.5 | Mechanical small-fry dedupes | rekeyed | | showcase escapeHtml done; `resolve()` → C.5; `writeJson`/`writeBinary` + per-language shard loop dropped (deleted indexer pkg); `#fetchCached` deferred; concept-bucket embedder deferred (test-only) |
| 3.1 | Collapse pre-hook sprawl, cut CI rebuilds | rekeyed → E.1 | | CI still builds 4×/job |
| 3.2 | Delete no-op vitest configs | rekeyed → E.3 | | analysis + relevance remain; indexer/benchmark gone |
| 3.3 | Intermediate tsconfig base | dropped | | `rootDir`/`outDir`/`include` resolve relative to the defining config; only `lib`/`types`/`verbatimModuleSyntax` could share and they already differ per package — no real collapse available |
| 3.4 | Parameterize fixture-policy tests | done | chore/cleanup-phase3-test-hygiene | |
| 3.5 | Rename misleading browser config | done | chore/cleanup-phase3-test-hygiene | now moot (benchmark deleted) but harmless |
| 4.1 | Split `client/src/search.ts` | rekeyed → C.1 | | line count now 1,544 |
| 4.2 | Split `indexer/src/build-index.ts` | dropped | #61 | TS indexer deleted; Python `build_index.py` split is C.4 |
| 4.3 | Split `indexer/src/write-index.ts` | dropped | #61 | TS indexer deleted |
| 4.4 | Extract html-to-text / snapshot-hash | rekeyed → C.6 | | |
| 4.5 | `#assertUsable` in client.ts | rekeyed → C.6 | | |
| 5.1 | Collapse promoteAndRender transaction | dropped | #61 | benchmark deleted |
| 5.2 | Slim DI surfaces | dropped | #61 | benchmark half gone; relevance half → C.6 |
| 5.3 | Resolve resolvePins warnings indirection | rekeyed → C.6 | | |
| 5.4 | One atomic-write helper | dropped | #61 | benchmark + govuk variants gone/reviewed in C.6 |
| 5.5 | Single CLI per package with subcommands | rekeyed → C.6 | | relevance only |
| 5.6 | Decide `Manifest.format` fate | rekeyed → C.6 | | |
| 5.7 | Replace literal NUL byte with escape | done | docs/cleanup-plan | |
| 6.1 | Binary format single home in `format` | rekeyed → F.1 | | separate decision |
| 6.2 | Unify relevance v1/v2 frameworks | rekeyed → F.2 | | fixture migration |

### New rows (added 2026-08-05, Step 0)

| Item | Description | Status | PR | Notes |
|---|---|---|---|---|
| 0.1 | Refresh this plan doc | done | | Python-only generator + dual clients scope |
| A.1 | Delete `packages/benchmark` + `packages/indexer` shells; fix vitest glob | done | | untracked; broken symlinks in their node_modules; vitest projects now explicit |
| A.2 | Add client `.gitignore`; ignore agent dirs; delete stale `.junie/` | done | | root `.gitignore` + `python/searchable-client/.gitignore` added; `.junie`/empty agent dirs deleted |
| A.3 | Python dead data/code: `build_index.py:540`, dup `"ik"`, `__init__.py` order | done | | `vector_definition` (F841) removed; dup `"ik"` out; `__init__` imports/all via ruff --fix |
| A.4 | ruff+mypy gates for analysis/indexer + wire into CI; fix autofixables | done | | analysis strict-green with 3 annotation fixes; indexer strict-green after annotating 12 modules + 2 type bugs (`quantize_int8` empty branch types, `id_range` narrowing, `stats` Optional handling); full gates (incl. `ruff format --check` + `mypy src`) now run in the `python-tests` CI job for all three packages |
| A.5 | Ship `py.typed` ×3; drop import-untyped ignores; real indexer `__all__` | done | | `py.typed` in all three src packages; ignores removed from client (`search.py`, `parse_query.py`); indexer `__init__.py` exports `build_index`, `write_index`, `discover_html_documents`, `extract_document`, `build_vector_shards`, `chunk_text` + types |
| A.6 | Prune TS analysis: delete `getOrCreate`; fix stale indexer-citing docs | done | | `getOrCreate` removed (0 callers); `detect-language.ts` + `package.json` descriptions corrected to the Python-only-indexer reality |
| A.7 | Indexer error conventions (TypeError, drop msg prefixes) | in-progress | | msg prefixes dropped (`build_index:`/`build_index_documents:` ×34); ValueError→TypeError deferred — ruff selects don't include TRY004 and 53 tests pin `ValueError` (behavior-changing) |
| B.1 | Python multi-word phrase-synonyms | done | | `_multi_word_variants_for` + attempt loop ported; variant words added to loaded-term set; 7 new tests mirroring the TS e2e multiWord suite (`test_search_multi_word_synonyms.py`), incl. literal-absent-from-corpus + highlight cases |
| B.2 | Hybrid fusion pins + candidate floor | done | | `fuseHybridResult` ported: pinned carried untouched/excluded from RRF+weighted fusion, re-merged in front, `remainingSlots`; floor now `max(limit*3, 30)`; 4 new tests (`test_hybrid_pins_parity.py`) |
| B.3 | No-vector-shard → empty result at raw `search()` level | done | | `_load_vector_hits` returns `[]` (TS parity); `SearchClient._query_vector` still raises `VectorUnavailableError` (test added) |
| B.4 | Fuzzy-cap truncation warning | done | | stderr warning mirroring TS `console.warn` text added at the cap; test asserts warning + exactly-cap scoring |
| B.5 | Error-base standardization (errors.py) | done | | new `SearchClientError(ValueError)` base; all vector errors + `InvalidManifestError` now subclass it; exported in `__init__` |
| B.6 | Indexer reuses analysis `generate_deletes` | done | | private fork removed; `searchable-analysis` shared function used |
| C.1 | Split TS `search.ts` → fuzzy/facets/hybrid/phrase + synonyms/doc-store/url | done | | search.ts 1,625 → 1,018; behavior-preserving; biome/typecheck/build/278 vitest green |
| C.2 | Split Python `search.py` → mirrored modules | done | | search.py 969 → 499; types moved to `types.py` + `__all__` re-export; `_BinaryFuzzyLookup` module-level; ruff/mypy/136 pytest green |
| C.3 | Split `language-profile.ts` → `stopwords.ts` | done | | stopwords moved; profiles + `stripDiacritics` remain; 77 analysis vitest + build/typecheck/biome green |
| C.4 | Split Python `build_index.py`; de-parametrize `_build_prepared_documents` | done | | `postings.py` extracted; `BuildConfig` bundles the ~15 kwargs; ruff/mypy/235 indexer pytest green |
| C.5 | Dedupe `resolve()` + binary directory decoders | done | | `decodeDirectory`/`read_directory` shared by the three shard directory decoders (both langs); client 278 vitest + 136 pytest green |
| C.6 | Carried relevance/client items (4.4,4.5,5.3,5.5,5.6) | done | | `html-to-text.ts` + `snapshot-hash.ts` extracted (govuk-normalize 394→224); `#assertUsable` unifies 3 duplicate guard preambles; `BuiltIndex.pin_warnings` carries warnings (stderr print kept); `cli-runner.ts` dedupes the CLI entry bootstrap (subcommand merge deferred); `Manifest.format` retained (decision recorded). relevance 165 vitest, client 278 vitest, indexer 235 pytest green |
| D.1 | De-triplicate `python-index.ts` into fixtures | done | | single source in `@ktjn/searchable-fixtures/python-index`; three facade re-exports; relevance gains the workspace dep; client 278 + relevance 165 + showcase 53 green |
| D.2 | Fold `relevance/static-server.ts` onto fixtures `serveDirectory` | done | | module deleted; both relevance runners import from fixtures; 165 relevance tests green |
| D.3 | Showcase build pipeline + `pageShell` options + escapeHtml | done | | `buildGalleryDemo` + `pageShell` meta/lang; escapeHtml shared; full showcase build + 53 tests green |
| D.4 | Merge showcase directory walkers | done | | `walk-files.ts` shared by build-search + site-validation |
| E.1 | Kill pre-hook rebuild sprawl (CI 4×→1) | pending | | |
| E.2 | Fold `uv sync` into setup-python action; update policy test | pending | | pages-workflow-policy coupling |
| E.3 | No-op vitest configs (analysis/relevance) | pending | | re-check workspace resolution |
| E.4 | `docs/project/language-support.md` reachability | pending | | |
| F.1 | Binary codec single home (re-examined) | pending | | separate decision |
| F.2 | Relevance v1/v2 unification | pending | | fixture migration |

### Ledger conventions

- Status values: `pending`, `in-progress`, `done`, `dropped`, `rekeyed`.
- `rekeyed` = original work still alive but tracked under its new phase key.
- `dropped` = rejected/obsolete; Notes must say why (usually #61 deleted the
  code).
- When starting an item, set `in-progress` and note the branch in Notes.
- When merging, set `done` and link the PR.
- Archive this file to `docs/archive/plans/code-cleanup-simplification.md` when
  every new row is `done` or `dropped`.
