# GitHub Actions Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate repeated GitHub Actions setup and verification, deploy Pages only after successful CI, retain the complete release gate, and move active automation to Node.js 24 LTS and Python 3.14.

**Architecture:** Repository-local composite actions own Node/pnpm and Python/uv setup. `ci.yml` becomes the only verification definition and supports both direct events and `workflow_call`; Pages consumes successful `main` CI revisions, while publishing invokes the reusable gate for the tag before npm publication.

**Tech Stack:** GitHub Actions reusable workflows, composite actions, pnpm 11, Node.js 24, Python 3.14, uv, Playwright, actionlint, PowerShell.

**Design:** [2026-07-13 GitHub Actions consolidation design](../specs/2026-07-13-github-actions-consolidation-design.md)

## Global Constraints

- Use Node.js 24 for active automation and require Node.js 24 or newer in current package metadata and installation documentation.
- Use Python 3.14 in CI while preserving `requires-python = ">=3.10"` in both Python packages.
- Keep the four CI jobs (`lint`, `python-tests`, `test`, and `test-browser`) independent and parallel.
- Playwright installation and execution belong only to CI's `test-browser` job.
- Automatic Pages deployment must use the exact successful `main` CI commit; `workflow_dispatch` remains an explicit override.
- npm credentials must be available only to the final publish job after the reusable CI gate succeeds.
- Do not change runtime search, indexing, showcase, or index-format behavior.

---

## File structure

- `.github/actions/setup-node/action.yml`: one composite action for pnpm, Node.js 24, pnpm caching, npm registry configuration, and frozen dependency installation.
- `.github/actions/setup-python/action.yml`: one composite action for Python 3.14 and cached `uv` setup.
- `.github/workflows/ci.yml`: authoritative four-job verification workflow, callable by other workflows and directly triggered by pull requests and `main` pushes.
- `.github/workflows/deploy-pages.yml`: static artifact build and deployment after successful `main` CI, with a manual override.
- `.github/workflows/publish.yml`: tag-triggered reusable verification followed by npm publication.
- `package.json`: Node.js 24 minimum engine declaration.
- `README.md`: current contributor runtime requirement.
- `docs/getting-started/installation.md`: current consumer build-tool requirement.

---

### Task 1: Shared setup actions and authoritative CI gate

**Files:**
- Create: `.github/actions/setup-node/action.yml`
- Create: `.github/actions/setup-python/action.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/getting-started/installation.md`

**Interfaces:**
- Produces: local action `./.github/actions/setup-node` that leaves pnpm dependencies installed under Node.js 24 with the npm registry configured.
- Produces: local action `./.github/actions/setup-python` that leaves Python 3.14 and cached `uv` available on `PATH`.
- Produces: reusable workflow `./.github/workflows/ci.yml` with no inputs or secrets and four required jobs.
- Consumes: root `packageManager: pnpm@11.11.0`, `pnpm-lock.yaml`, and the existing root test scripts.

- [ ] **Step 1: Capture the pre-change duplication and version baseline**

Run:

```powershell
rg -n 'pnpm/action-setup|actions/setup-node|node-version|actions/setup-python|python-version|pnpm install --frozen-lockfile' .github/workflows
rg -n 'Node\.js 20|"node": ">=20"' README.md docs/getting-started/installation.md package.json
```

Expected: setup sequences occur in multiple workflows; active workflow versions are Node.js 22 and Python 3.12; the current documented and declared Node.js minimum is 20.

- [ ] **Step 2: Create the Node setup composite action**

Create `.github/actions/setup-node/action.yml` exactly as follows:

```yaml
name: Set up Node.js workspace
description: Install pnpm, Node.js, and frozen workspace dependencies

runs:
  using: composite
  steps:
    - uses: pnpm/action-setup@v6
    - uses: actions/setup-node@v6
      with:
        node-version: 24
        cache: pnpm
        registry-url: https://registry.npmjs.org
    - name: Install workspace dependencies
      shell: bash
      run: pnpm install --frozen-lockfile
```

This action has no inputs: every current consumer uses the same Node version, package manager, lockfile policy, and registry.

- [ ] **Step 3: Create the Python setup composite action**

Create `.github/actions/setup-python/action.yml` exactly as follows:

```yaml
name: Set up Python workspace
description: Install Python and uv with dependency caching

runs:
  using: composite
  steps:
    - uses: actions/setup-python@v6
      with:
        python-version: "3.14"
    - uses: astral-sh/setup-uv@v8.3.2
      with:
        enable-cache: true
```

Do not run `uv sync` here because `python-tests` synchronizes two projects while the cross-implementation `test` job needs only `python/csf-indexer`.

- [ ] **Step 4: Replace CI setup duplication and add `workflow_call`**

Replace `.github/workflows/ci.yml` with:

```yaml
name: CI

on:
  workflow_call:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: ./.github/actions/setup-node
      - run: pnpm lint

  python-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: ./.github/actions/setup-python
      - name: Install and test csf-analysis (Python)
        working-directory: python/csf-analysis
        run: |
          uv sync
          uv run pytest -v
      - name: Install and test csf-indexer (Python)
        working-directory: python/csf-indexer
        run: |
          uv sync
          uv run pytest -v

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: ./.github/actions/setup-node
      - uses: ./.github/actions/setup-python
      - name: Set up csf-indexer (Python, needed by the cross-implementation conformance test)
        working-directory: python/csf-indexer
        run: uv sync
      - run: pnpm typecheck
      - run: pnpm size
      - run: pnpm test

  test-browser:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: ./.github/actions/setup-node
      - name: Cache Playwright browser binaries
        id: playwright-cache
        uses: actions/cache@v6
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}
      # A cache hit restores the browser binary but not the runner's apt-level
      # OS dependencies, so only the browser download is skippable.
      - name: Install Playwright browser + OS dependencies (cache miss)
        if: steps.playwright-cache.outputs.cache-hit != 'true'
        run: pnpm exec playwright install --with-deps chromium
      - name: Install Playwright OS dependencies only (cache hit)
        if: steps.playwright-cache.outputs.cache-hit == 'true'
        run: pnpm exec playwright install-deps chromium
      - run: pnpm test:browser
```

Keep checkout before each local composite action because repository-local actions are unavailable until the repository has been checked out.

- [ ] **Step 5: Align the active Node.js support floor**

Make these exact replacements:

```json
// package.json
"engines": {
  "node": ">=24"
}
```

```markdown
<!-- README.md -->
Requires Node.js 24 or newer and pnpm 11.
```

```markdown
<!-- docs/getting-started/installation.md -->
The packages require Node.js 24 or newer for build tooling. `@csf/client` targets modern browsers with `fetch`, `URL`, and optional Web Worker and Service Worker support.
```

Do not rewrite historical plans or design records that accurately record the versions used when those documents were created.

- [ ] **Step 6: Validate workflow syntax and version ownership**

Run:

```powershell
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12
uvx yamllint -d "{extends: relaxed, rules: {line-length: disable}}" .github/actions
if (rg -n 'node-version:\s*22|python-version:\s*"3\.12"' .github/actions .github/workflows/ci.yml) { throw 'Obsolete CI version remains' }
if (rg -n 'uses:\s+(actions/setup-node|actions/setup-python|pnpm/action-setup|astral-sh/setup-uv)@' .github/workflows/ci.yml) { throw 'CI bypasses the composite setup actions' }
rg -n 'node-version:\s*24|python-version:\s*"3\.14"' .github/actions
rg -n 'workflow_call|uses: \./\.github/actions/setup-(node|python)' .github/workflows/ci.yml
```

Expected: actionlint and yamllint exit 0 without findings; no obsolete version or direct setup action remains in CI; both composite versions and `workflow_call` are found. `actionlint` checks workflow files, while yamllint checks the composite metadata's YAML structure; GitHub-hosted CI in Task 4 exercises the composite-action schema and behavior.

- [ ] **Step 7: Verify both language environments locally**

Run:

```powershell
node --version
python --version
pnpm install --frozen-lockfile
Push-Location python/csf-analysis; uv sync; uv run pytest -q; Pop-Location
Push-Location python/csf-indexer; uv sync; uv run pytest -q; Pop-Location
```

Expected: Node reports `v24.x`, Python reports `3.14.x`, the frozen install succeeds, and both Python test suites pass.

- [ ] **Step 8: Commit the shared setup and CI gate**

```powershell
git add .github/actions/setup-node/action.yml .github/actions/setup-python/action.yml .github/workflows/ci.yml package.json README.md docs/getting-started/installation.md
git diff --cached --check
git commit -m "ci: centralize runtime setup and checks"
```

Expected: one commit containing the reusable CI foundation, composite actions, and matching current-version documentation.

---

### Task 2: Deploy Pages only after successful CI

**Files:**
- Modify: `.github/workflows/deploy-pages.yml`

**Interfaces:**
- Consumes: direct workflow named `CI` from `.github/workflows/ci.yml` and its successful `main` `workflow_run.head_sha`.
- Consumes: local action `./.github/actions/setup-node` from Task 1.
- Produces: a Pages artifact from `showcase/dist` for the exact verified revision, or the manually dispatched revision.

- [ ] **Step 1: Record the current redundant browser gate**

Run:

```powershell
rg -n 'push:|playwright|docs:check|workflow_run|docs:build|showcase validate' .github/workflows/deploy-pages.yml
```

Expected: the workflow directly triggers on `main`, installs Playwright, and runs `pnpm docs:check`; it has no `workflow_run` trigger.

- [ ] **Step 2: Replace Pages with an exact-revision static deployment**

Replace `.github/workflows/deploy-pages.yml` with:

```yaml
name: Deploy showcase to GitHub Pages

on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
  workflow_dispatch:

# Only one Pages deployment at a time; don't cancel one that's already
# publishing partway through.
concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    if: github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success'
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7
        with:
          ref: ${{ github.event.workflow_run.head_sha || github.sha }}
      - uses: ./.github/actions/setup-node
      - run: pnpm docs:build
      - run: pnpm --filter showcase validate
      - uses: actions/configure-pages@v6
      - uses: actions/upload-pages-artifact@v5
        with:
          path: showcase/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    # Deliberately no `environment: github-pages` block: deployment
    # Environments with protection rules are unavailable for this private
    # repository's plan, and actions/deploy-pages does not require one.
    steps:
      - uses: actions/deploy-pages@v5
        id: deployment
```

The job-level condition allows manual dispatch but blocks automatic deployment after failed or cancelled CI. Do not add pull-request execution to this privileged `workflow_run` workflow.

- [ ] **Step 3: Validate syntax, security boundaries, and Playwright ownership**

Run:

```powershell
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12
if (rg -n 'playwright|docs:check|^\s+push:' .github/workflows/deploy-pages.yml) { throw 'Pages still owns CI/browser behavior' }
rg -n 'workflow_run|workflows: \[CI\]|branches: \[main\]|conclusion == .success.|head_sha|workflow_dispatch' .github/workflows/deploy-pages.yml
rg -n 'pnpm docs:build|pnpm --filter showcase validate' .github/workflows/deploy-pages.yml
```

Expected: actionlint exits 0; the forbidden search has no matches; the successful-CI condition, exact SHA, manual override, build, and validation commands are all found.

- [ ] **Step 4: Exercise the exact local artifact path**

Run:

```powershell
pnpm docs:build
pnpm --filter showcase validate
Test-Path showcase/dist/index.html
Test-Path showcase/dist/gallery/index.html
```

Expected: both commands exit 0 and both path checks print `True`.

- [ ] **Step 5: Commit the Pages simplification**

```powershell
git add .github/workflows/deploy-pages.yml
git diff --cached --check
git commit -m "ci: deploy Pages after successful checks"
```

Expected: one commit that removes Playwright from Pages and deploys the verified revision.

---

### Task 3: Gate npm publication through reusable CI

**Files:**
- Modify: `.github/workflows/publish.yml`

**Interfaces:**
- Consumes: reusable workflow `./.github/workflows/ci.yml` from Task 1 with no inputs or secrets.
- Consumes: local action `./.github/actions/setup-node` from Task 1.
- Consumes: repository secret `NPM_TOKEN` only as the final publish step's `NODE_AUTH_TOKEN`.
- Produces: npm publication only after all four reusable CI jobs succeed for the tag revision.

- [ ] **Step 1: Record the duplicated publishing checks**

Run:

```powershell
rg -n 'setup-node|setup-python|pnpm install|pnpm lint|pnpm typecheck|pnpm size|pnpm test|playwright|pnpm publish' .github/workflows/publish.yml
```

Expected: publishing repeats setup, lint, type, size, unit, and browser steps before `pnpm publish`.

- [ ] **Step 2: Replace duplicated checks with the reusable gate**

Replace `.github/workflows/publish.yml` with:

```yaml
name: Publish

on:
  push:
    tags:
      - "v*"

jobs:
  checks:
    permissions:
      contents: read
    uses: ./.github/workflows/ci.yml

  publish:
    needs: checks
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v7
      - uses: ./.github/actions/setup-node
      - run: pnpm publish -r --access public --no-git-checks --provenance
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Do not use `secrets: inherit` on `checks`. The reusable verification gate needs no credentials; only the dependent `publish` job receives the npm token.

- [ ] **Step 3: Validate syntax and release-gate ownership**

Run:

```powershell
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12
if (rg -n 'playwright|pnpm lint|pnpm typecheck|pnpm size|pnpm test$|setup-python|setup-uv' .github/workflows/publish.yml) { throw 'Publish still duplicates verification' }
rg -n 'checks:|uses: \./\.github/workflows/ci\.yml|needs: checks|uses: \./\.github/actions/setup-node|NODE_AUTH_TOKEN|pnpm publish' .github/workflows/publish.yml
```

Expected: actionlint exits 0; no duplicated verification matches; the reusable gate dependency, shared Node setup, scoped token, and publication command are found.

- [ ] **Step 4: Audit secret and permission placement**

Run:

```powershell
$publish = Get-Content -Raw .github/workflows/publish.yml
if (($publish | Select-String -AllMatches 'NPM_TOKEN').Matches.Count -ne 1) { throw 'NPM_TOKEN must appear exactly once' }
if ($publish -match 'secrets:\s+inherit') { throw 'Reusable CI must not inherit secrets' }
rg -n 'contents: read|id-token: write|NPM_TOKEN' .github/workflows/publish.yml
```

Expected: `NPM_TOKEN` appears exactly once under the publish step, no inherited secrets exist, and least-privilege declarations are displayed.

- [ ] **Step 5: Commit the publishing consolidation**

```powershell
git add .github/workflows/publish.yml
git diff --cached --check
git commit -m "ci: reuse checks before npm publishing"
```

Expected: one commit that retains browser verification through `checks` but removes every copied verification step from `publish`.

---

### Task 4: Full local and hosted verification

**Files:**
- Review: `.github/actions/setup-node/action.yml`
- Review: `.github/actions/setup-python/action.yml`
- Review: `.github/workflows/ci.yml`
- Review: `.github/workflows/deploy-pages.yml`
- Review: `.github/workflows/publish.yml`
- Review: `package.json`
- Review: `README.md`
- Review: `docs/getting-started/installation.md`

**Interfaces:**
- Consumes: all deliverables from Tasks 1-3.
- Produces: evidence that local package, browser, Python, documentation, YAML, and policy gates pass before hosted CI is requested.

- [ ] **Step 1: Run final workflow syntax and policy checks**

Run:

```powershell
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12
uvx yamllint -d "{extends: relaxed, rules: {line-length: disable}}" .github/actions
if (rg -n 'node-version:\s*22|python-version:\s*"3\.12"' .github) { throw 'Obsolete workflow version remains' }
if (rg -n 'playwright' .github/workflows/deploy-pages.yml .github/workflows/publish.yml) { throw 'Playwright escaped the CI browser job' }
if ((rg -l 'actions/setup-node|pnpm/action-setup' .github -g '*.yml').Count -ne 1) { throw 'Node setup has more than one owner' }
if ((rg -l 'actions/setup-python|setup-uv' .github -g '*.yml').Count -ne 1) { throw 'Python setup has more than one owner' }
```

Expected: actionlint exits 0; all policy assertions complete without throwing; setup implementations exist only in their respective composite actions.

- [ ] **Step 2: Run Python verification**

Run:

```powershell
Push-Location python/csf-analysis; uv sync; uv run pytest -v; Pop-Location
Push-Location python/csf-indexer; uv sync; uv run pytest -v; Pop-Location
```

Expected: both complete suites pass on Python 3.14.

- [ ] **Step 3: Run the complete JavaScript and browser gates**

Run:

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm size
pnpm test
pnpm test:browser
```

Expected: every command exits 0; Playwright reports all browser tests passing.

- [ ] **Step 4: Reproduce the Pages artifact gate**

Run:

```powershell
pnpm docs:build
pnpm --filter showcase validate
```

Expected: the documentation and showcase build completes and static validation reports that all local links, assets, and fragments resolve.

- [ ] **Step 5: Apply the mandatory documentation review**

Use the `doc-review` skill for `README.md` and `docs/getting-started/installation.md`. Record all four phases:

```text
Phase 1: structural validation
Phase 2: cross-reference consistency
Phase 3: coverage completeness and explicit no-ADR rationale
Phase 4: quality and current-version consistency
```

Expected: all phases pass. No ADR changes are required because the product architecture, deployment model, compatibility model, and index format are unchanged.

- [ ] **Step 6: Review the final branch diff**

Run:

```powershell
git status -sb
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- .github package.json README.md docs/getting-started/installation.md
```

Expected: only the approved design, plan, setup actions, workflow files, and version documentation are changed; no generated `showcase/dist` files or unrelated edits are present.

- [ ] **Step 7: Publish a branch and verify hosted behavior**

Use `superpowers:finishing-a-development-branch` to choose and perform the publication path. On the resulting pull request, verify:

```powershell
gh pr checks --watch
```

Expected: all four CI jobs pass using the composite actions on GitHub-hosted runners. After merge, confirm the successful `main` CI run triggers one `Deploy showcase to GitHub Pages` run whose checkout SHA equals the CI run's `head_sha`. Do not create a release tag solely to test npm credentials.

---

## Spec coverage self-review

- Shared Node and Python setup actions: Task 1, Steps 2-3.
- Reusable four-job CI gate with Playwright ownership: Task 1, Steps 4 and 6.
- Node.js 24 runtime floor and Python 3.14 CI without dropping Python 3.10 compatibility: Task 1, Steps 3 and 5-7.
- Exact successful-commit Pages deployment, manual override, static-only validation, concurrency, and least privilege: Task 2, Steps 2-4.
- Tag-specific reusable checks, secret isolation, provenance, and publication: Task 3, Steps 2-4.
- Failure and security behavior: Tasks 2-3 policy checks and Task 4 final audit.
- Local package, Python, browser, documentation, actionlint, and hosted verification: Task 4.
- ADR impact and non-goals: Global Constraints and Task 4, Steps 5-6.

The plan introduces no runtime APIs or type signatures. Every local action and reusable-workflow interface used by later tasks is defined in Task 1 with the same path and responsibility.
