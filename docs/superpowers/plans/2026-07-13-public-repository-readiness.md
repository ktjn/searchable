# Public Repository Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Searchable truthful, navigable, and safely configured for public source visibility while its npm and Python packages remain unpublished.

**Architecture:** Treat public readiness as a tested repository contract. A Vitest policy test owns durable file, wording, and package-metadata requirements; public documentation and community files satisfy that contract; GitHub settings are applied through `gh` and recorded in a maintainer checklist when the private plan prevents a setting.

**Tech Stack:** Markdown, JSON package manifests, GitHub issue forms, GitHub Actions, Vitest, pnpm, PowerShell, GitHub CLI.

**Design:** [2026-07-13 public repository readiness design](../specs/2026-07-13-public-repository-readiness-design.md)

## Global Constraints

- Do not change repository visibility.
- Do not rewrite Git history or author metadata.
- Do not create a tag, GitHub release, npm publication, or PyPI publication.
- Say explicitly that npm and Python packages are not yet published.
- Keep public npm manifest versions at `1.0.0` and Node.js at `>=24`.
- Keep the package names, product APIs, and index format unchanged.
- Preserve the separate `docs/documentation-showcase-redesign` worktree and its untracked `.superpowers/` directory.

---

### Task 1: Add the public-readiness contract

**Files:**
- Create: `showcase/test/public-readiness-policy.test.ts`

**Interfaces:**
- Consumes: tracked repository files and public package manifests.
- Produces: a durable Vitest gate consumed by local `pnpm test` and CI.

- [ ] **Step 1: Write the failing policy test**

Create a test that reads files relative to the repository root and asserts:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = join(import.meta.dirname, "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("public community and package documentation exists", () => {
  for (const path of [
    "CONTRIBUTING.md",
    "SECURITY.md",
    ".github/ISSUE_TEMPLATE/bug-report.yml",
    ".github/ISSUE_TEMPLATE/feature-request.yml",
    ".github/ISSUE_TEMPLATE/config.yml",
    ".github/pull_request_template.md",
    "packages/client/README.md",
    "packages/indexer/README.md",
    "packages/analysis/README.md",
    "packages/format/README.md",
    "docs/project/public-launch-checklist.md",
  ]) {
    expect(() => read(path), path).not.toThrow();
  }
});

test("public docs describe an unpublished preview", () => {
  const docs = [
    read("README.md"),
    read("docs/getting-started/installation.md"),
    read("docs/reference/compatibility.md"),
    read("CHANGELOG.md"),
  ].join("\n");

  expect(docs).toContain("not yet published");
  expect(docs).not.toContain("The published package API is `1.0.0`");
  expect(docs).not.toContain("are published in lockstep at `1.0.0`");
  expect(read("README.md")).not.toContain("pnpm add @ktjn/searchable-client");
  expect(read("docs/getting-started/installation.md")).not.toContain(
    "pnpm add @ktjn/searchable-client",
  );
});

test("public npm manifests are prepared for the planned first release", () => {
  for (const directory of ["client", "indexer", "analysis", "format"]) {
    const pkg = JSON.parse(read(`packages/${directory}/package.json`)) as {
      version?: string;
      engines?: { node?: string };
      repository?: { url?: string };
    };
    expect(pkg.version, directory).toBe("1.0.0");
    expect(pkg.engines?.node, directory).toBe(">=24");
    expect(pkg.repository?.url, directory).toBe(
      "git+https://github.com/ktjn/searchable.git",
    );
  }
});

test("post-public security gates are recorded", () => {
  const checklist = read("docs/project/public-launch-checklist.md");
  for (const gate of [
    "secret scanning",
    "push protection",
    "private vulnerability reporting",
    "Dependabot security updates",
    "code scanning",
    "main ruleset",
  ]) {
    expect(checklist).toContain(gate);
  }
});
```

- [ ] **Step 2: Verify the test fails for the missing public surface**

Run:

```powershell
pnpm --filter showcase test -- public-readiness-policy.test.ts
```

Expected: FAIL because community files, package READMEs, `engines`, preview wording, and the checklist are absent.

- [ ] **Step 3: Commit the red test**

```powershell
git add showcase/test/public-readiness-policy.test.ts
git commit -m "test: define public repository readiness"
```

---

### Task 2: Make release status truthful

**Files:**
- Modify: `README.md`
- Modify: `docs/getting-started/installation.md`
- Modify: `docs/reference/compatibility.md`
- Modify: `docs/reference/client-api.md`
- Modify: `docs/project/governance.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: the public-preview launch position from the design.
- Produces: one consistent release story for repository visitors and future contributors.

- [ ] **Step 1: Replace the README npm quick start**

Use a `Public preview` section that states that npm and PyPI packages are not yet published, links the live gallery, and provides only repository development commands:

````markdown
## Public preview

The npm and Python packages are not yet published. Evaluate the implemented
search surfaces in the [live feature gallery](https://ktjn.github.io/searchable/gallery/)
or work with the repository directly:

```bash
git clone https://github.com/ktjn/searchable.git
cd searchable
corepack enable
pnpm install
pnpm docs:check
```

The package manifests are prepared for a coordinated first npm release at
`1.0.0`. Until that release exists, do not use the package names in production
installation commands.
````

Keep the existing TypeScript example under an `API shape` subheading and state that it demonstrates the planned package import.

- [ ] **Step 2: Align installation and compatibility documentation**

In `installation.md`, replace npm installation commands with the same preview statement and repository clone/setup commands. In `compatibility.md`, say the four manifests are prepared in lockstep at `1.0.0`, semver promises begin with actual publication, and no registry package exists yet. In `client-api.md`, call the described surface the planned `1.0.0` package API.

- [ ] **Step 3: Align governance and changelog**

Change compatibility wording in governance from unconditional published-package language to “When published, the four npm packages move in lockstep.” Rename the changelog release heading to:

```markdown
## [Unreleased]

### Prepared for 1.0.0
```

Retain the existing feature inventory, but replace “First stable release” with “Prepared feature summary for the planned first stable release.”

- [ ] **Step 4: Verify release claims are internally consistent**

```powershell
rg -n "published package API|are published in lockstep|installs the published|Install .* from npm|First stable release" README.md CHANGELOG.md docs --glob '!docs/archive/**' --glob '!docs/superpowers/**'
```

Expected: no matches.

- [ ] **Step 5: Commit truthful public documentation**

```powershell
git add README.md CHANGELOG.md docs/getting-started/installation.md docs/reference/compatibility.md docs/reference/client-api.md docs/project/governance.md
git commit -m "docs: describe Searchable as a public preview"
```

---

### Task 3: Prepare public package metadata

**Files:**
- Create: `packages/client/README.md`
- Create: `packages/indexer/README.md`
- Create: `packages/analysis/README.md`
- Create: `packages/format/README.md`
- Modify: `packages/client/package.json`
- Modify: `packages/indexer/package.json`
- Modify: `packages/analysis/package.json`
- Modify: `packages/format/package.json`

**Interfaces:**
- Consumes: canonical package names and the unpublished-preview contract.
- Produces: informative npm tarballs and explicit Node support metadata.

- [ ] **Step 1: Add package-local READMEs**

Each README must contain its package name, the exact role from its `description`, this notice, and repository links:

```markdown
> Public preview: this package is not yet published to npm. The repository is
> preparing a coordinated first release at `1.0.0`.

See the [Searchable repository](https://github.com/ktjn/searchable),
[documentation](https://ktjn.github.io/searchable/), and
[feature gallery](https://ktjn.github.io/searchable/gallery/).
```

Add one package-specific paragraph: browser runtime and worker/service-worker exports for client; rendered-HTML indexing and CLI for indexer; shared analysis for analysis; manifest/shard types for format.

- [ ] **Step 2: Add the Node engine contract**

Add this immediately after `type` in each public package manifest:

```json
"engines": {
  "node": ">=24"
}
```

- [ ] **Step 3: Run the policy test**

```powershell
pnpm --filter showcase test -- public-readiness-policy.test.ts
```

Expected: community/checklist assertions still fail; package README and metadata assertions pass.

- [ ] **Step 4: Commit package readiness**

```powershell
git add packages/client packages/indexer packages/analysis packages/format
git commit -m "docs: prepare public npm package metadata"
```

---

### Task 4: Add contribution and issue workflows

**Files:**
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`
- Create: `.github/ISSUE_TEMPLATE/bug-report.yml`
- Create: `.github/ISSUE_TEMPLATE/feature-request.yml`
- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Create: `.github/pull_request_template.md`

**Interfaces:**
- Consumes: existing governance, test commands, issue tracker, and GitHub Security tab.
- Produces: copyable contribution and private-reporting paths.

- [ ] **Step 1: Write contribution and security policies**

`CONTRIBUTING.md` must cover Node 24, pnpm 11, `pnpm install`, focused tests, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:browser`, deterministic cross-implementation output, docs, ADR expectations, and focused PRs. `SECURITY.md` must state that no registry version is released yet, direct reports to **Security → Report a vulnerability**, prohibit public vulnerability issues, and promise acknowledgement without inventing a fixed response SLA.

- [ ] **Step 2: Add structured issue forms**

The bug form must require observed behavior, expected behavior, reproduction, environment, and affected package/surface. The feature form must require consumer problem, proposed outcome, alternatives, and scope. `config.yml` must set `blank_issues_enabled: false` and link security reports to `/security/advisories/new`.

- [ ] **Step 3: Add the pull-request template**

Include summary, linked issue, verification commands/results, compatibility or format impact, documentation impact, and a checklist for focused scope, tests, docs, and no generated artifacts.

- [ ] **Step 4: Commit the community surface**

```powershell
git add CONTRIBUTING.md SECURITY.md .github/ISSUE_TEMPLATE .github/pull_request_template.md
git commit -m "docs: add public contribution workflows"
```

---

### Task 5: Add the public launch checklist

**Files:**
- Create: `docs/project/public-launch-checklist.md`
- Modify: `docs/project/governance.md`

**Interfaces:**
- Consumes: current GitHub API state and settings unavailable until public.
- Produces: the exact maintainer sequence for the visibility cutover.

- [ ] **Step 1: Write the checklist**

Separate it into `Before visibility`, `Visibility change`, and `Immediately after public`. Include unchecked decisions for accepting non-noreply commit metadata and making the repository public. Include verification commands or UI paths for topics, Wiki, `main` ruleset, secret scanning, push protection, private vulnerability reporting, Dependabot security updates, code scanning, Pages, README links, and npm remaining unpublished.

- [ ] **Step 2: Link it from governance**

Add the checklist to the release-checklist section as the source for repository visibility and security setup.

- [ ] **Step 3: Run the policy test to green**

```powershell
pnpm --filter showcase test -- public-readiness-policy.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit the checklist**

```powershell
git add docs/project/public-launch-checklist.md docs/project/governance.md
git commit -m "docs: add public launch checklist"
```

---

### Task 6: Apply reversible GitHub properties

**Files:**
- Modify externally: `ktjn/searchable` repository metadata.
- Modify on a plan limitation: `docs/project/public-launch-checklist.md`

**Interfaces:**
- Consumes: GitHub CLI authentication and the existing four CI check names.
- Produces: topics, canonical docs ownership, and best-available `main` protection.

- [ ] **Step 1: Add topics and disable Wiki**

```powershell
gh repo edit ktjn/searchable --enable-wiki=false --add-topic static-search --add-topic full-text-search --add-topic browser-search --add-topic typescript --add-topic python --add-topic bm25 --add-topic offline-first --add-topic search-engine
gh repo view ktjn/searchable --json hasWikiEnabled,repositoryTopics
```

Expected: Wiki false and all eight topics present.

- [ ] **Step 2: Create the `main` ruleset**

Run:

```powershell
$body = @{
  name = "Protect main"
  target = "branch"
  enforcement = "active"
  conditions = @{ ref_name = @{ include = @("~DEFAULT_BRANCH"); exclude = @() } }
  rules = @(
    @{ type = "deletion" },
    @{ type = "non_fast_forward" },
    @{
      type = "pull_request"
      parameters = @{
        dismiss_stale_reviews_on_push = $false
        require_code_owner_review = $false
        require_last_push_approval = $false
        required_approving_review_count = 0
        required_review_thread_resolution = $false
      }
    },
    @{
      type = "required_status_checks"
      parameters = @{
        do_not_enforce_on_create = $true
        strict_required_status_checks_policy = $true
        required_status_checks = @(
          @{ context = "lint" },
          @{ context = "python-tests" },
          @{ context = "test" },
          @{ context = "test-browser" }
        )
      }
    }
  )
} | ConvertTo-Json -Depth 10 -Compress
$body | gh api --method POST repos/ktjn/searchable/rulesets --input -
```

Expected: a ruleset named `Protect main` is returned. Do not add an admin bypass. If GitHub returns a private-plan limitation, leave protection unchanged and record the exact limitation as pending in the launch checklist.

- [ ] **Step 3: Verify visibility did not change**

```powershell
gh repo view ktjn/searchable --json visibility,hasWikiEnabled,repositoryTopics
```

Expected: visibility remains `PRIVATE`.

- [ ] **Step 4: Commit a checklist update only if GitHub deferred the ruleset**

```powershell
git add docs/project/public-launch-checklist.md
git commit -m "docs: record deferred public repository setting"
```

Skip when the file is unchanged.

---

### Task 7: Verify and publish the readiness PR

**Files:**
- Verify: entire repository and GitHub metadata.

**Interfaces:**
- Consumes: Tasks 1-6.
- Produces: a reviewable PR that does not change visibility or publish packages.

- [ ] **Step 1: Run focused documentation and policy checks**

```powershell
pnpm --filter showcase test -- public-readiness-policy.test.ts
pnpm docs:build
pnpm --filter showcase validate
git diff --check origin/main...HEAD
```

Expected: all pass.

- [ ] **Step 2: Run full verification**

```powershell
pnpm lint
pnpm typecheck
pnpm size
pnpm test
pnpm test:browser
```

Run both Python suites through their existing `uv run pytest -v` commands. Expected: all pass.

- [ ] **Step 3: Inspect package artifacts**

Pack each public npm workspace into `.artifacts/public-readiness/`, list tarball contents, and verify each contains its package README, license, JavaScript, declarations, `package.json`, and documented entry points. Remove `.artifacts/` after inspection.

- [ ] **Step 4: Run the documentation review skill**

Use `doc-review` for structural validation, cross-reference consistency, coverage completeness, and quality gates. Resolve every finding before publication.

- [ ] **Step 5: Resolve review findings in their owning task**

If review changes a file, repeat that task's focused test and amend with a new `docs: finalize public repository readiness` commit using the explicit changed paths shown by `git diff --name-only`. If review is clean, make no commit.

- [ ] **Step 6: Push and open the PR**

Push `chore/public-readiness` and open a ready PR titled `docs: prepare Searchable for public visibility`. State clearly that visibility, history, tags, releases, npm, and PyPI are unchanged.

- [ ] **Step 7: Wait for all four CI checks**

```powershell
gh pr checks --watch --repo ktjn/searchable
```

Expected: `lint`, `python-tests`, `test`, and `test-browser` pass.
