# Post-Merge Planning Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the public-readiness PR is merged, remove completed internal agent plans/specs while preserving durable product history and documentation.

**Architecture:** Make absence of `docs/superpowers/` a tested repository policy, redirect the two surviving external references to durable documentation, delete the planning tree mechanically, and publish the cleanup as a separate PR from fresh `main`.

**Tech Stack:** Markdown, TypeScript, Vitest, Git, pnpm.

**Design:** [2026-07-13 public repository readiness design](../specs/2026-07-13-public-repository-readiness-design.md)

## Global Constraints

- Do not start until the public-readiness PR is merged.
- Start from a freshly fetched and fast-forwarded `main`.
- Remove `docs/superpowers/plans/` and `docs/superpowers/specs/` completely.
- Preserve `docs/archive/`, `docs/adr/`, `docs/project/roadmap.md`, and implementation history.
- Preserve the separate documentation worktree and its untracked `.superpowers/` directory.
- Do not change repository visibility, history, tags, releases, or package publication.

---

### Task 1: Establish the post-merge cleanup branch

**Files:**
- Verify only: repository and worktree state.

**Interfaces:**
- Consumes: merged public-readiness PR.
- Produces: isolated branch `docs/remove-internal-plans` from current `origin/main`.

- [ ] **Step 1: Verify the readiness PR is merged**

```powershell
$pr = gh pr list --repo ktjn/searchable --state merged --head chore/public-readiness --json number --jq '.[0].number'
if (-not $pr) { throw "No merged public-readiness PR found" }
gh pr view $pr --repo ktjn/searchable --json state,mergedAt,mergeCommit
```

Expected: `state` is `MERGED`.

- [ ] **Step 2: Synchronize main and create the cleanup branch**

```powershell
git switch main
git pull --ff-only
git switch -c docs/remove-internal-plans
```

- [ ] **Step 3: Record the initial reference inventory**

```powershell
rg -n "docs/superpowers|superpowers/(plans|specs)" . --glob '!docs/superpowers/**' --glob '!node_modules/**' --glob '!.worktrees/**'
```

Expected: the binary conformance comment, project-identity allowlist, and generic showcase exclusion are the only relevant matches.

---

### Task 2: Make internal planning documents forbidden

**Files:**
- Modify: `showcase/test/project-identity-policy.test.ts`

**Interfaces:**
- Consumes: Git's tracked file list.
- Produces: a permanent policy preventing internal plans/specs from returning.

- [ ] **Step 1: Write the failing policy assertion**

Remove the two-path `allowed` set and its filter. Add:

```ts
test("tracked files exclude internal agent planning documents", () => {
  const files = execFileSync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean)
    .map((path) => path.replaceAll("\\", "/"));

  expect(files.filter((path) => path.startsWith("docs/superpowers/"))).toEqual(
    [],
  );
});
```

- [ ] **Step 2: Verify the test fails for tracked planning files**

```powershell
pnpm --filter showcase test -- project-identity-policy.test.ts
```

Expected: FAIL listing `docs/superpowers/` files; the identity test may also fail because its old-name allowlist was removed.

- [ ] **Step 3: Commit the red policy test**

```powershell
git add showcase/test/project-identity-policy.test.ts
git commit -m "test: exclude internal planning documents"
```

---

### Task 3: Redirect durable references and delete planning records

**Files:**
- Modify: `packages/client/test/cross-implementation-conformance-python-indexer.test.ts`
- Delete: `docs/superpowers/plans/`
- Delete: `docs/superpowers/specs/`

**Interfaces:**
- Consumes: durable binary-storage documentation and the red cleanup policy.
- Produces: a public tree without internal execution records or broken references.

- [ ] **Step 1: Redirect the binary conformance comment**

Replace the reference at the binary conformance block with:

```ts
/**
 * Byte-identical conformance for the binary storage tier
 * (docs/concepts/binary-storage.md):
```

- [ ] **Step 2: Remove completed plans and specs mechanically**

```powershell
git rm -r docs/superpowers
```

Expected: all files under both planning directories are staged for deletion, including the public-readiness design and both implementation plans.

- [ ] **Step 3: Verify the policy is green**

```powershell
pnpm --filter showcase test -- project-identity-policy.test.ts
```

Expected: PASS for both Searchable identity and absence of internal planning documents.

- [ ] **Step 4: Verify no stale planning reference remains**

```powershell
rg -n "docs/superpowers|superpowers/(plans|specs)" . --glob '!node_modules/**' --glob '!.worktrees/**'
```

Expected: only the generic `FORBIDDEN_DOC_PATHS` guard in `showcase/site-validation.ts` may remain; it prevents accidental publication and does not link to a deleted file.

- [ ] **Step 5: Commit cleanup**

```powershell
git add packages/client/test/cross-implementation-conformance-python-indexer.test.ts showcase/test/project-identity-policy.test.ts
git commit -m "docs: remove completed internal plans"
```

---

### Task 4: Verify and publish the cleanup PR

**Files:**
- Verify: repository documentation, tests, and Git state.

**Interfaces:**
- Consumes: completed cleanup commit.
- Produces: a small post-merge PR with no product behavior changes.

- [ ] **Step 1: Run documentation and focused checks**

```powershell
pnpm --filter showcase test -- project-identity-policy.test.ts docs-site.test.ts site-validation.test.ts
pnpm docs:build
pnpm --filter showcase validate
git diff --check origin/main...HEAD
```

Expected: all pass and generated docs contain no archive or internal planning path.

- [ ] **Step 2: Run reference and placeholder scans**

```powershell
rg -n "docs/superpowers|superpowers/(plans|specs)" . --glob '!node_modules/**' --glob '!.worktrees/**'
rg -n ("TO" + "DO|T" + "BD|PLACE" + "HOLDER") README.md CONTRIBUTING.md SECURITY.md docs --glob '!docs/archive/**'
```

Expected: no stale links or cleanup placeholders; only the intentional generic publication guard may match the first command.

- [ ] **Step 3: Run the documentation review skill**

Use `doc-review` and resolve structural, cross-reference, coverage, and quality findings.

- [ ] **Step 4: Push and open a separate PR**

Push `docs/remove-internal-plans` and open a ready PR titled `docs: remove completed internal plans`. Explain that durable ADRs, archive, roadmap, and implementation history remain.

- [ ] **Step 5: Watch CI**

```powershell
gh pr checks --watch --repo ktjn/searchable
```

Expected: all required checks pass before merge.
