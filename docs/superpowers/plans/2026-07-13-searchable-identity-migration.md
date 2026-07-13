# Searchable Identity Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Atomically rename the complete project identity to Searchable, verify every package and protocol surface, then rename the GitHub repository, Pages site, remote, and local checkout after merge.

**Architecture:** The pull request migrates npm identity, TypeScript CMS controls, Python projects/imports, schema identifiers, branding, and documentation in test-first slices while a final repository policy test prevents stale identifiers. External GitHub, Pages, and filesystem changes happen only after the fully verified branch is merged.

**Tech Stack:** TypeScript 7, Python 3.14, Node.js 24, pnpm 11, uv, Vitest, Playwright, JSON Schema, GitHub Actions, GitHub CLI, PowerShell.

**Design:** [2026-07-13 Searchable identity migration design](../specs/2026-07-13-searchable-identity-migration-design.md)

## Global Constraints

- Public npm packages are exactly `@ktjn/searchable-client`, `@ktjn/searchable-indexer`, `@ktjn/searchable-analysis`, and `@ktjn/searchable-format`, all at `1.0.0`.
- The private fixture package is exactly `@ktjn/searchable-fixtures` at `0.0.0`.
- Local Python distributions are `searchable-analysis` and `searchable-indexer` at `0.1.0`; import packages are `searchable_analysis` and `searchable_indexer`.
- The only CLI name is `searchable-indexer`.
- CMS controls use only `searchable-*` and `data-searchable-*`; no legacy aliases or dual parsing remain.
- Generic API names such as `SearchClient`, `SearchResult`, `buildIndex`, and `SourceDocument` do not change.
- `Manifest.version` remains `1`; serialized index and binary formats do not change.
- No npm or Python package is published and no release tag is created.
- The migration spec and this plan are the only tracked files allowed to contain former identifiers.
- The GitHub repository, Pages site, remote, and local directory are renamed only after the code PR is green and merged.
- Preserve the nested documentation worktree and its untracked `.superpowers/` directory; never delete it to force the local path rename.

---

## File structure

- `package.json`, `packages/*/package.json`, `showcase/package.json`, `pnpm-lock.yaml`: npm workspace identities and dependency graph.
- `packages/indexer/src/extract.ts`: authoritative TypeScript parser for Searchable CMS controls.
- `packages/indexer/src/cli.ts`: TypeScript `searchable-indexer` usage surface.
- `python/searchable-analysis/`: renamed Python analysis distribution and `searchable_analysis` import package.
- `python/searchable-indexer/`: renamed Python indexer distribution, `searchable_indexer` import package, and CLI.
- `spec/schema/*.schema.json`: canonical Searchable schema identifiers and descriptions; shapes remain unchanged.
- `showcase/docs-site.ts`, `showcase/gallery-shared.ts`, `showcase/build-*.ts`: Searchable generated-site branding and repository links.
- `showcase/test/project-identity-policy.test.ts`: tracked-file policy that rejects every former identity outside the migration documents.
- `README.md`, `CHANGELOG.md`, `LICENSE`, `docs/**`, `spec/examples/**`: current and historical documentation rewritten to teach only Searchable names.

---

### Task 1: Rename the npm workspace and TypeScript CLI

**Files:**
- Modify: `package.json`
- Modify: `packages/analysis/package.json`
- Modify: `packages/client/package.json`
- Modify: `packages/fixtures/package.json`
- Modify: `packages/format/package.json`
- Modify: `packages/indexer/package.json`
- Modify: `showcase/package.json`
- Modify: `packages/indexer/src/cli.ts`
- Modify: `packages/client/test/consumer-fixture.test.ts`
- Modify: `packages/indexer/test/consumer-fixture.test.ts`
- Modify: all tracked TypeScript, JavaScript, JSON, and Markdown files containing an `@csf/*` package reference
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: five workspace package names under `@ktjn/searchable-*` and the sole binary `searchable-indexer`.
- Preserves: package exports and generic runtime APIs.
- Consumes: existing workspace directory layout under `packages/*`.

- [ ] **Step 1: Change consumer contracts to the new package and binary names**

In `packages/client/test/consumer-fixture.test.ts`, replace package resolution and imports with:

```ts
const resolved = require.resolve("@ktjn/searchable-client");
const mod = await import("@ktjn/searchable-client");
```

Preserve all existing export assertions. In
`packages/indexer/test/consumer-fixture.test.ts`, require the new package and
binary exactly:

```ts
const resolved = require.resolve("@ktjn/searchable-indexer");
const mod = await import("@ktjn/searchable-indexer");
expect(pkg.bin).toEqual({ "searchable-indexer": "./dist/cli.js" });
const cliPath = join(packageRoot, pkg.bin["searchable-indexer"]);
```

Also update that test's temporary directory prefixes to
`searchable-cli-in-` and `searchable-cli-out-`.

- [ ] **Step 2: Run the consumer tests and verify RED**

Run:

```powershell
pnpm exec vitest run packages/client/test/consumer-fixture.test.ts packages/indexer/test/consumer-fixture.test.ts
```

Expected: FAIL because the new package names cannot resolve and the indexer manifest still exposes the old binary.

- [ ] **Step 3: Apply the exact npm identity mapping**

Use a bounded mechanical replacement across tracked text files, excluding the
design and this plan:

```text
@csf/client   -> @ktjn/searchable-client
@csf/indexer  -> @ktjn/searchable-indexer
@csf/analysis -> @ktjn/searchable-analysis
@csf/format   -> @ktjn/searchable-format
@csf/fixtures -> @ktjn/searchable-fixtures
```

Then set the root and package manifest names explicitly:

```json
// package.json
"name": "searchable"

// packages/analysis/package.json
"name": "@ktjn/searchable-analysis"

// packages/client/package.json
"name": "@ktjn/searchable-client"

// packages/fixtures/package.json
"name": "@ktjn/searchable-fixtures"

// packages/format/package.json
"name": "@ktjn/searchable-format"

// packages/indexer/package.json
"name": "@ktjn/searchable-indexer",
"bin": {
  "searchable-indexer": "./dist/cli.js"
}
```

Keep all existing versions unchanged. Change `packages/indexer/src/cli.ts` to:

```ts
console.error("usage: searchable-indexer <inputDir> <outDir>");
```

Update indexer diagnostic prefixes in TypeScript source to
`[searchable-indexer]` and the opt-in test variable to
`SEARCHABLE_TEST_REAL_TRANSFORMERS`.

- [ ] **Step 4: Regenerate and audit the pnpm lockfile**

Run:

```powershell
pnpm install --lockfile-only
pnpm install --frozen-lockfile
rg -n '@csf/|csf-indexer' package.json packages showcase pnpm-lock.yaml -g '*.json' -g '*.ts' -g '*.mjs' -g '*.yaml'
```

Expected: both installs succeed; the final search has no matches outside files
that belong to later Python or CMS tasks.

- [ ] **Step 5: Verify the new npm graph and consumer contracts**

Run:

```powershell
pnpm build
pnpm typecheck
pnpm exec vitest run packages/client/test/consumer-fixture.test.ts packages/indexer/test/consumer-fixture.test.ts
```

Expected: all commands pass and both consumer tests resolve only
`@ktjn/searchable-*` packages.

- [ ] **Step 6: Commit the npm identity**

```powershell
git add package.json pnpm-lock.yaml packages showcase/package.json docs README.md CHANGELOG.md spec
git diff --cached --check
git commit -m "refactor: rename npm packages to Searchable"
```

Expected: one commit containing the npm package graph, TypeScript CLI, and all
package-name references changed by the exact mapping.

---

### Task 2: Rename the TypeScript CMS control surface

**Files:**
- Modify: `packages/indexer/test/extract.test.ts`
- Modify: `packages/indexer/test/build-index.test.ts`
- Modify: `packages/indexer/test/prototype-safe-keys.test.ts`
- Modify: `packages/indexer/test/write-index.test.ts`
- Modify: `packages/client/test/e2e.test.ts`
- Modify: `packages/client/test/binary-doc-store.test.ts`
- Modify: `packages/client/test/binary-term-shard.test.ts`
- Modify: `packages/client/e2e-browser/worker.spec.ts`
- Modify: `packages/fixtures/test/generate.test.ts`
- Modify: `packages/indexer/src/extract.ts`
- Modify: TypeScript source, fixtures, showcase builders, schema descriptions, and current guides containing CMS names

**Interfaces:**
- Produces: TypeScript extraction contract using only `searchable-*` and `data-searchable-*`.
- Preserves: extracted document types, ranking, facets, pins, and serialized index behavior.

- [ ] **Step 1: Change TypeScript extraction tests to the Searchable controls**

Apply this exact mapping in the listed TypeScript tests and fixtures, but do not
change `packages/indexer/src/extract.ts` yet:

```text
data-csf-body          -> data-searchable-body
data-csf-ignore        -> data-searchable-ignore
csf-noindex            -> searchable-noindex
csf-boost              -> searchable-boost
csf-facet-range-       -> searchable-facet-range-
csf-facet-             -> searchable-facet-
csf-pin-exclusive      -> searchable-pin-exclusive
csf-pin-priority       -> searchable-pin-priority
csf-pin-mode           -> searchable-pin-mode
csf-pin                -> searchable-pin
```

Test names and comments must use the new controls as well.

- [ ] **Step 2: Run extraction and end-to-end tests and verify RED**

Run:

```powershell
pnpm exec vitest run packages/indexer/test/extract.test.ts packages/indexer/test/build-index.test.ts packages/client/test/e2e.test.ts packages/fixtures/test/generate.test.ts
```

Expected: FAIL because the TypeScript extractor still queries the former
selectors and prefixes.

- [ ] **Step 3: Implement the Searchable selectors in the TypeScript indexer**

In `packages/indexer/src/extract.ts`, use these constants and selectors:

```ts
const FACET_TAG_PREFIX = "searchable-facet-";
const RANGE_FACET_TAG_PREFIX = "searchable-facet-range-";

const noindex =
  root.querySelector('meta[name="searchable-noindex"]') !== null;

const body =
  root.querySelector("[data-searchable-body]") ??
  root.querySelector("main") ??
  root.querySelector("body");

const ignored = [
  ...BOILERPLATE_SELECTORS,
  "[data-searchable-ignore]",
].join(",");
```

Use `searchable-boost`, `searchable-pin`, `searchable-pin-mode`,
`searchable-pin-priority`, and `searchable-pin-exclusive` in their existing
queries. Do not add legacy selector alternatives.

- [ ] **Step 4: Update maintained TypeScript producers and documentation**

Apply the mapping from Step 1 to:

```text
packages/fixtures/src/generate.ts
packages/indexer/src/**/*.ts
packages/client/src/**/*.ts
showcase/build-gallery.ts
docs/guides/facets.md
docs/guides/pinning.md
docs/guides/ranking-and-boosts.md
docs/reference/cms-meta-tags.md
spec/schema/term-shard.schema.json
```

Update comments and diagnostic prose without changing exported type or function
names.

- [ ] **Step 5: Verify all TypeScript CMS behavior**

Run:

```powershell
pnpm exec vitest run packages/indexer packages/client packages/fixtures
pnpm typecheck
rg -n 'csf-(noindex|boost|facet|pin)|data-csf-' packages showcase -g '*.ts' -g '*.mjs'
```

Expected: tests and type checks pass; the search has no TypeScript or showcase
matches except the cross-implementation test, which changes with Python in Task
3.

- [ ] **Step 6: Commit the TypeScript CMS rename**

```powershell
git add packages showcase docs/guides docs/reference/cms-meta-tags.md spec/schema/term-shard.schema.json
git diff --cached --check
git commit -m "refactor: rename CMS controls to Searchable"
```

---

### Task 3: Rename the Python distributions, modules, CLI, and CMS controls

**Files:**
- Rename: `python/csf-analysis` -> `python/searchable-analysis`
- Rename: `python/csf-indexer` -> `python/searchable-indexer`
- Rename: `python/searchable-analysis/src/csf_analysis` -> `python/searchable-analysis/src/searchable_analysis`
- Rename: `python/searchable-indexer/src/csf_indexer` -> `python/searchable-indexer/src/searchable_indexer`
- Modify: both Python `pyproject.toml` files
- Modify: all Python source and tests under the renamed directories
- Modify: `packages/client/test/cross-implementation-conformance-python-indexer.test.ts`
- Modify: current Python paths and commands in `README.md`, `docs/getting-started/installation.md`, and `docs/guides/indexing.md`

**Interfaces:**
- Produces: local `searchable-analysis` and `searchable-indexer` distributions, `searchable_analysis` and `searchable_indexer` modules, and `searchable-indexer` CLI.
- Produces: Python parsing of only the Searchable CMS controls.
- Preserves: Python 3.10 minimum and TypeScript/Python output conformance.

- [ ] **Step 1: Change Python behavior contracts before moving source**

In the existing Python tests, replace imports with `searchable_analysis` and
`searchable_indexer`, replace CLI expectations with `searchable-indexer`, and
apply the CMS mapping from Task 2. In the TypeScript cross-implementation test,
set:

```ts
const pythonIndexerDir = join(repoRoot, "python", "searchable-indexer");
```

Run the CLI as:

```ts
execFileSync("uv", ["run", "searchable-indexer", srcDir, pyOutDir], {
  cwd: pythonIndexerDir,
  stdio: "pipe",
});
```

Use inline imports from `searchable_indexer` in the test's generated Python
program.

- [ ] **Step 2: Run the Python public API, CLI, extraction, and cross-language tests and verify RED**

Run:

```powershell
Push-Location python/csf-analysis; uv run pytest tests/test_public_api.py -v; Pop-Location
Push-Location python/csf-indexer; uv run pytest tests/test_cli.py tests/test_extract.py -v; Pop-Location
pnpm exec vitest run packages/client/test/cross-implementation-conformance-python-indexer.test.ts
```

Expected: FAIL because the renamed import packages, project path, CLI, and CMS
selectors do not yet exist.

- [ ] **Step 3: Move the projects and import-package directories**

Run from the repository root:

```powershell
git mv python/csf-analysis python/searchable-analysis
git mv python/csf-indexer python/searchable-indexer
git mv python/searchable-analysis/src/csf_analysis python/searchable-analysis/src/searchable_analysis
git mv python/searchable-indexer/src/csf_indexer python/searchable-indexer/src/searchable_indexer
```

- [ ] **Step 4: Update Python packaging metadata and imports**

Set `python/searchable-analysis/pyproject.toml` to:

```toml
[project]
name = "searchable-analysis"
version = "0.1.0"
description = "Multi-language tokenization, stemming, and language detection for Searchable (Python port of @ktjn/searchable-analysis)."
requires-python = ">=3.10"
dependencies = []

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/searchable_analysis"]

[dependency-groups]
dev = ["pytest>=8.0.0"]
```

In the indexer project, preserve existing dependencies and dev dependencies but
set these exact identity fields:

```toml
[project]
name = "searchable-indexer"
version = "0.1.0"
description = "Reference index builder for Searchable (Python port of the lexical-core subset of @ktjn/searchable-indexer)."

[project.scripts]
searchable-indexer = "searchable_indexer.cli:main"

[tool.hatch.build.targets.wheel]
packages = ["src/searchable_indexer"]

[tool.uv.sources]
searchable-analysis = { path = "../searchable-analysis", editable = true }
```

Change its dependency from `csf-analysis` to `searchable-analysis`. Mechanically
replace `csf_analysis` with `searchable_analysis` and `csf_indexer` with
`searchable_indexer` throughout the renamed Python trees and cross-language
test.

- [ ] **Step 5: Implement the Python Searchable CMS selectors and diagnostics**

In `python/searchable-indexer/src/searchable_indexer/extract.py`, use:

```python
_FACET_TAG_PREFIX = "searchable-facet-"
_RANGE_FACET_TAG_PREFIX = "searchable-facet-range-"

def _warn(message: str) -> None:
    print(f"[searchable-indexer] {message}", file=sys.stderr)
```

Replace every CSS selector with the exact Searchable equivalent from Task 2.
Change `python/searchable-indexer/src/searchable_indexer/cli.py` usage text to:

```python
print("usage: searchable-indexer <inputDir> <outDir>", file=sys.stderr)
```

- [ ] **Step 6: Sync and verify both renamed Python projects**

Run:

```powershell
Push-Location python/searchable-analysis; uv sync; uv run pytest -v; Pop-Location
Push-Location python/searchable-indexer; uv sync; uv run pytest -v; Pop-Location
pnpm exec vitest run packages/client/test/cross-implementation-conformance-python-indexer.test.ts
rg -n 'csf[-_]|@csf/' python packages/client/test/cross-implementation-conformance-python-indexer.test.ts
```

Expected: 57 analysis tests, 131 indexer tests, and the cross-implementation
test pass; the final search returns no matches.

- [ ] **Step 7: Commit the Python migration**

```powershell
git add python packages/client/test/cross-implementation-conformance-python-indexer.test.ts README.md docs/getting-started/installation.md docs/guides/indexing.md
git diff --cached --check
git commit -m "refactor: rename Python packages to Searchable"
```

---

### Task 4: Rename schema identity, showcase branding, and live links

**Files:**
- Modify: `spec/schema/*.schema.json`
- Modify: `showcase/docs-site.ts`
- Modify: `showcase/gallery-shared.ts`
- Modify: `showcase/build-docs.ts`
- Modify: `showcase/build-gallery-index.ts`
- Modify: other `showcase/build-*.ts` identity strings
- Modify: `showcase/test/docs-site.test.ts`
- Modify: `showcase/e2e-browser/showcase.spec.ts`
- Modify: `README.md`
- Modify: `docs/getting-started/overview.md`
- Modify: package repository, homepage, and bugs metadata

**Interfaces:**
- Produces: Searchable site chrome, repository links, Pages links, schema IDs, and current onboarding copy.
- Preserves: showcase layout, search behavior, page count, and schema validation rules.

- [ ] **Step 1: Change showcase and schema contracts to the new identity**

In `showcase/test/docs-site.test.ts`, update every expected repository URL to
`https://github.com/ktjn/searchable`. In the browser spec, require the homepage
heading and brand link to contain `Searchable` and the gallery link to begin
with `https://ktjn.github.io/searchable/` where an absolute URL is asserted.

In every schema conformance test, require each `$id` to start with:

```text
https://raw.githubusercontent.com/ktjn/searchable/main/spec/schema/
```

- [ ] **Step 2: Run focused site and schema tests and verify RED**

Run:

```powershell
pnpm exec vitest run --config showcase/vitest.config.ts showcase/test/docs-site.test.ts
Push-Location python/searchable-indexer; uv run pytest tests/test_schema_conformance.py -v; Pop-Location
```

Expected: FAIL because generated links, brand copy, and schema IDs still use the
former repository and product identity.

- [ ] **Step 3: Apply the root branding and repository mapping**

Across tracked files except the migration spec and plan, replace:

```text
client-search-framework                         -> searchable
https://github.com/ktjn/client-search-framework -> https://github.com/ktjn/searchable
https://ktjn.github.io/client-search-framework/ -> https://ktjn.github.io/searchable/
```

Then use human-facing capitalization `Searchable` in headings, navigation
brands, descriptions, and prose. Keep machine-facing package names lowercase.
Update every public package manifest to:

```json
"repository": {
  "type": "git",
  "url": "git+https://github.com/ktjn/searchable.git",
  "directory": "packages/<package-directory>"
},
"homepage": "https://github.com/ktjn/searchable#readme",
"bugs": "https://github.com/ktjn/searchable/issues"
```

- [ ] **Step 4: Update all schema identifiers without changing shapes**

For each `spec/schema/<name>.schema.json`, set:

```json
"$id": "https://raw.githubusercontent.com/ktjn/searchable/main/spec/schema/<name>.schema.json"
```

Update product and CMS identity in schema titles and descriptions. Do not
change `type`, `required`, `properties`, validation bounds, or
`Manifest.version`.

- [ ] **Step 5: Implement Searchable site branding**

Set the repository constant in `showcase/docs-site.ts` to:

```ts
const repositoryUrl = "https://github.com/ktjn/searchable";
```

Render the navigation brand as `Searchable` in `showcase/docs-site.ts` and
`showcase/gallery-shared.ts`. Use `Searchable` as the fallback title in
`showcase/build-docs.ts`. Update gallery prose and build logs to name the new
packages.

- [ ] **Step 6: Verify the current site and schemas**

Run:

```powershell
pnpm exec vitest run --config showcase/vitest.config.ts showcase/test/docs-site.test.ts
Push-Location python/searchable-indexer; uv run pytest tests/test_schema_conformance.py -v; Pop-Location
pnpm docs:build
pnpm --filter showcase validate
```

Expected: focused tests pass and static validation reports all links, assets,
and fragments resolve.

- [ ] **Step 7: Commit schema and branding identity**

```powershell
git add README.md package.json packages/*/package.json python/*/pyproject.toml showcase spec/schema docs/getting-started/overview.md
git diff --cached --check
git commit -m "docs: rebrand project as Searchable"
```

---

### Task 5: Enforce the identity policy and migrate all historical text

**Files:**
- Create: `showcase/test/project-identity-policy.test.ts`
- Modify: `CHANGELOG.md`
- Modify: `LICENSE`
- Modify: all current and archived Markdown under `docs/`
- Modify: `spec/examples/**`
- Modify: remaining tracked source, comments, test descriptions, temporary prefixes, and environment variables reported by the policy test

**Interfaces:**
- Produces: one automated tracked-file gate with exactly two allowlisted migration documents.
- Produces: current and historical documentation that teaches only Searchable names.

- [ ] **Step 1: Add the repository identity policy test**

Create `showcase/test/project-identity-policy.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const repositoryRoot = join(import.meta.dirname, "..", "..");
const acronym = ["c", "s", "f"].join("");
const oldSlug = ["client", "search", "framework"].join("-");
const allowed = new Set([
  "docs/superpowers/specs/2026-07-13-searchable-identity-migration-design.md",
  "docs/superpowers/plans/2026-07-13-searchable-identity-migration.md",
]);
const forbidden = [
  new RegExp(oldSlug, "i"),
  new RegExp(`@${acronym}/`, "i"),
  new RegExp(`\\b${acronym}[-_]`, "i"),
  new RegExp(`\\b${acronym}\\b`, "i"),
];

test("tracked files use only the Searchable identity", () => {
  const files = execFileSync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean)
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => !allowed.has(path));

  const violations: string[] = [];
  for (const path of files) {
    const bytes = readFileSync(join(repositoryRoot, path));
    if (bytes.includes(0)) continue;
    const text = bytes.toString("utf8");
    for (const pattern of forbidden) {
      if (pattern.test(text)) violations.push(`${path}: ${pattern.source}`);
    }
  }

  expect(violations).toEqual([]);
});
```

The test constructs former identifiers from fragments so it does not have to
allowlist itself.

- [ ] **Step 2: Run the identity test and verify RED**

Run:

```powershell
pnpm exec vitest run --config showcase/vitest.config.ts showcase/test/project-identity-policy.test.ts
```

Expected: FAIL with a concrete list of remaining tracked files and forbidden
identity families.

- [ ] **Step 3: Apply the complete residual identity mapping**

For every violation outside the two migration documents, apply:

```text
@csf/<package>                   -> corresponding @ktjn/searchable-<package>
client-search-framework         -> searchable
csf-analysis / csf-indexer      -> searchable-analysis / searchable-indexer
csf_analysis / csf_indexer      -> searchable_analysis / searchable_indexer
csf-<CMS or temporary prefix>   -> searchable-<same suffix>
CSF_TEST_REAL_TRANSFORMERS      -> SEARCHABLE_TEST_REAL_TRANSFORMERS
standalone CSF or csf branding  -> Searchable
```

Update archived paths and code examples to their new real locations. Preserve
dates, conclusions, statuses, and historical sequencing. Update the license
project heading but do not change license terms or copyright ownership.

- [ ] **Step 4: Re-run the policy and inspect the allowlist**

Run:

```powershell
pnpm exec vitest run --config showcase/vitest.config.ts showcase/test/project-identity-policy.test.ts
rg -n -i 'client-search-framework|@csf/|\bcsf[-_]|\bcsf\b' --glob '!docs/superpowers/specs/2026-07-13-searchable-identity-migration-design.md' --glob '!docs/superpowers/plans/2026-07-13-searchable-identity-migration.md'
```

Expected: the policy test passes and ripgrep returns no matches. Do not add a
third allowlist entry.

- [ ] **Step 5: Run the mandatory documentation review and build**

Apply the `doc-review` skill to every changed file under `docs/` and `spec/`.
Verify all four phases, then run:

```powershell
pnpm docs:build
pnpm --filter showcase validate
```

Expected: doc/spec review passes with zero blockers, and the generated site has
no broken local links, assets, or fragments.

- [ ] **Step 6: Commit the complete identity sweep**

```powershell
git add CHANGELOG.md LICENSE README.md docs spec packages python showcase
git diff --cached --check
git commit -m "docs: remove legacy project identity"
```

---

### Task 6: Verify npm packages, Python wheels, and the full repository

**Files:**
- Review: all files changed in Tasks 1-5
- Generated and delete after inspection: `.artifacts/npm/`
- Generated and delete after inspection: `.artifacts/python/`

**Interfaces:**
- Produces: package-content and full-suite evidence without publishing.
- Consumes: final Searchable npm and Python package identities.

- [ ] **Step 1: Verify workflow syntax and active identity**

Run:

```powershell
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12
uvx --from yamllint==1.37.1 yamllint -d "{extends: relaxed, rules: {line-length: disable}}" .github/actions
pnpm exec vitest run --config showcase/vitest.config.ts showcase/test/project-identity-policy.test.ts
```

Expected: all three gates exit 0.

- [ ] **Step 2: Run both complete Python suites**

Run:

```powershell
Push-Location python/searchable-analysis; uv sync; uv run pytest -v; Pop-Location
Push-Location python/searchable-indexer; uv sync; uv run pytest -v; Pop-Location
```

Expected: all analysis and indexer tests pass on Python 3.14.

- [ ] **Step 3: Build and inspect Python wheels without publishing**

Run:

```powershell
New-Item -ItemType Directory -Force .artifacts/python | Out-Null
uv build --project python/searchable-analysis --wheel --out-dir .artifacts/python
uv build --project python/searchable-indexer --wheel --out-dir .artifacts/python
python -c "import pathlib,zipfile; wheels=list(pathlib.Path('.artifacts/python').glob('*.whl')); assert len(wheels)==2; names=[]; [names.extend(zipfile.ZipFile(w).namelist()) for w in wheels]; assert any(n.startswith('searchable_analysis/') for n in names); assert any(n.startswith('searchable_indexer/') for n in names); assert not any('csf_' in n for n in names); print(*[w.name for w in wheels], sep='\n')"
```

Expected: two wheels are produced; only the new import-package roots exist.

- [ ] **Step 4: Pack and inspect all public npm packages without publishing**

Run:

```powershell
New-Item -ItemType Directory -Force .artifacts/npm | Out-Null
pnpm --filter @ktjn/searchable-analysis pack --pack-destination .artifacts/npm
pnpm --filter @ktjn/searchable-format pack --pack-destination .artifacts/npm
pnpm --filter @ktjn/searchable-indexer pack --pack-destination .artifacts/npm
pnpm --filter @ktjn/searchable-client pack --pack-destination .artifacts/npm
Get-ChildItem .artifacts/npm/*.tgz | Select-Object Name,Length
```

Expected: four non-empty `1.0.0` tarballs exist with Searchable package names.
Inspect each with `tar -tf`; the client includes worker and service-worker
entries, and the indexer includes its CLI.

- [ ] **Step 5: Run every repository gate independently**

Run each command separately and stop on the first non-zero exit:

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm size
pnpm test
pnpm test:browser
pnpm docs:check
```

Expected: lint passes, type checks and size budgets pass, all unit and browser
tests pass, and the full publishing gate validates the generated site.

On Windows, if Biome reports CRLF on untouched files, verify `pnpm lint` from a
temporary LF-normalized local clone of this branch. Do not normalize the entire
working tree or commit line-ending-only changes.

- [ ] **Step 6: Delete generated packaging artifacts safely**

Resolve `.artifacts` to an absolute path and verify it is beneath the current
worktree root before removing it recursively. Then run:

```powershell
git status --short
```

Expected: `.artifacts` is gone and the worktree contains no generated output.

- [ ] **Step 7: Review the complete branch**

Run:

```powershell
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git status -sb
```

Expected: only migration source, tests, metadata, docs, and planning records
are present; the worktree is clean.

---

### Task 7: Publish the PR and perform the post-merge cutover

**Files and external state:**
- GitHub repository: `ktjn/client-search-framework` -> `ktjn/searchable`
- Git remote: `origin` -> `https://github.com/ktjn/searchable.git`
- GitHub About homepage: `https://ktjn.github.io/searchable/`
- Pages workflow: `.github/workflows/deploy-pages.yml`
- Local root: `C:\git\client-search-framework` -> `C:\git\searchable`
- Preserved nested worktree: `.worktrees/documentation-showcase-redesign`

**Interfaces:**
- Consumes: a green, merged Searchable code PR and explicit user authorization to merge.
- Produces: live `ktjn/searchable`, working Searchable Pages site, updated remote, and best-effort local directory rename.

- [ ] **Step 1: Open and verify the code pull request**

Use `superpowers:finishing-a-development-branch` to push the branch and create a
draft PR. Include `Doc/spec review: all phases passed` in the PR body. Watch:

```powershell
gh pr checks --watch
```

Expected: `lint`, `python-tests`, `test`, and `test-browser` all pass using the
renamed package graph. Do not perform any external rename before merge.

- [ ] **Step 2: Stop for explicit merge authorization**

Present the green PR to the user and wait. Continue only when the user asks to
merge it. Merge with the repository's merge-commit style and verify the PR state
is `MERGED`.

- [ ] **Step 3: Rename the GitHub repository and verify redirects**

Run:

```powershell
gh repo rename searchable --repo ktjn/client-search-framework --yes
gh repo view ktjn/searchable --json nameWithOwner,url,visibility
git remote set-url origin https://github.com/ktjn/searchable.git
git remote -v
```

Expected: the live repository is `ktjn/searchable`, the old repository URL
redirects in an HTTP request, and both fetch and push remotes use the new URL.

- [ ] **Step 4: Update repository About metadata**

Run:

```powershell
gh repo edit ktjn/searchable --description "Static search indexing and in-browser search without a query-time backend." --homepage "https://ktjn.github.io/searchable/"
gh repo view ktjn/searchable --json description,homepageUrl
```

Expected: both fields contain the exact Searchable values.

- [ ] **Step 5: Deploy and verify the new Pages project site**

Run:

```powershell
gh workflow run deploy-pages.yml --repo ktjn/searchable --ref main
gh run list --repo ktjn/searchable --workflow deploy-pages.yml --limit 1
```

Watch the new run to completion. Then verify:

```powershell
Invoke-WebRequest -UseBasicParsing https://ktjn.github.io/searchable/
Invoke-WebRequest -UseBasicParsing https://ktjn.github.io/searchable/gallery/
```

Expected: the Pages run succeeds; both requests return HTTP 200 and contain
Searchable branding. Verify a documentation page, asset, fragment, and GitHub
source link in a browser. The old Pages project URL is intentionally retired.

- [ ] **Step 6: Synchronize local main before moving directories**

From `C:\git\client-search-framework`, run:

```powershell
git switch main
git pull --ff-only
git status -sb
git worktree list --porcelain
git -C .worktrees/documentation-showcase-redesign status -sb
```

Expected: local `main` matches `origin/main`; both worktrees are visible; the
nested worktree's untracked `.superpowers/` directory remains untouched.

- [ ] **Step 7: Rename the local root and repair worktree registrations**

Run this step from `C:\git`, not from inside the directory being moved. First
verify `C:\git\searchable` does not exist. Then:

```powershell
Move-Item -LiteralPath C:\git\client-search-framework -Destination C:\git\searchable
git -C C:\git\searchable worktree repair C:\git\searchable\.worktrees\documentation-showcase-redesign
git -C C:\git\searchable worktree list
git -C C:\git\searchable status -sb
git -C C:\git\searchable\.worktrees\documentation-showcase-redesign status -sb
```

Expected: the main root is `C:\git\searchable`, both worktrees are registered
at their new absolute paths, main is clean, and the nested worktree still shows
its original untracked `.superpowers/` directory. If the move or repair fails,
do not delete or overwrite either directory; retain the old path and report the
single incomplete cosmetic step.

---

## Spec coverage self-review

- Exact npm, fixture, CLI, and version mapping: Task 1.
- Searchable-only TypeScript CMS controls without aliases: Task 2.
- Python distribution, directory, module, CLI, CMS, and local-only publication scope: Task 3.
- Canonical schema IDs, unchanged format version, showcase branding, GitHub links, and Pages base: Task 4.
- Current and historical text migration plus a two-file-only identity allowlist: Task 5.
- npm tarballs, Python wheels, conformance, browser, docs, lint, and full local verification: Task 6.
- Hosted CI, explicit merge gate, repository rename, metadata, Pages redeployment, remote update, and safe local/worktree move: Task 7.
- No package publication, compatibility aliases, generic API renames, format changes, or history rewriting: Global Constraints and every task boundary.

All package paths and names consumed by later tasks match the outputs defined by
earlier tasks. The only old-name references intentionally retained by the final
policy are the approved design and this plan.
