# Production-core Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove obsolete and duplicated code, reduce unnecessary exports and dependencies, make the live showcase prominent on the homepage, and limit feature-gallery searches to four results.

**Architecture:** Keep the existing package boundaries and runtime behavior. Delete completed binary investigation programs, place the one genuinely shared SymSpell helper in the already-shared `@csf/analysis` package, and make implementation-only symbols private without introducing new layers. Apply the gallery limit once in the shared widget so every demo follows the same rule.

**Tech Stack:** TypeScript 7, Node.js 20+, pnpm 11, Vite 8, Vitest 4, Playwright, Biome, Markdown, plain browser DOM APIs.

## Global Constraints

- Preserve runtime search behavior and index-format compatibility.
- Public TypeScript names may change only when doing so removes real weight; root-package export changes must follow ADR-0004 and update compatibility documentation.
- Prefer deletion over relocation and require a net reduction in code and exported concepts.
- Do not split cohesive files solely to reduce their line counts.
- Do not combine the independently installable TypeScript and Python implementations.
- Do not add configuration for the fixed four-result showcase rule.
- Keep distinct showcase examples and behavior tests.
- Baseline production-like TypeScript/JavaScript surface: 77 tracked `.ts`/`.mjs` files and 10,922 lines, excluding `test/`, `e2e-browser/`, generated declarations, and `dist/`.
- Baseline TypeScript export declarations across `packages/` and `showcase/`: 196.
- The four pre-existing Windows-only failures involving CRLF stemmer fixtures and slash-sensitive package-export assertions are not regressions from this work.

---

## File map

- `README.md`: source for both the repository README and hosted homepage.
- `showcase/src/gallery-widget.ts`: single runtime controller for all feature-gallery searches.
- `showcase/e2e-browser/showcase.spec.ts`: real-browser homepage and gallery behavior coverage.
- `packages/analysis/src/generate-deletes.ts`: new single implementation of Unicode-aware SymSpell deletion generation.
- `packages/analysis/src/index.ts`: shared analysis package barrel.
- `packages/analysis/test/generate-deletes.test.ts`: focused contract tests for the shared helper.
- `packages/client/src/search.ts`: query-time consumer of `generateDeletes`.
- `packages/indexer/src/build-index.ts`: index-time consumer of `generateDeletes`.
- `packages/client/src/parse-query.ts`, `packages/indexer/src/write-index.ts`, `showcase/gallery-data.ts`: implementation-only export cleanup.
- `showcase/package.json`, `pnpm-lock.yaml`: removal of an unused workspace dev dependency.
- `packages/indexer/package.json`: removal of retired binary benchmark commands.
- `packages/indexer/bench/binary-vs-json-postings.mjs`, `packages/indexer/bench/binary-lazy-decode.mjs`: completed investigations to delete.
- Binary shard source comments and archived investigation/roadmap pages: replace stale executable-script references with the archived conclusion.

---

### Task 1: Make the showcase prominent and cap results at four

**Files:**
- Modify: `README.md`
- Modify: `showcase/src/gallery-widget.ts`
- Test: `showcase/e2e-browser/showcase.spec.ts`

**Interfaces:**
- Consumes: existing `SearchClientLike.search(query, options)` and generated homepage from `README.md`.
- Produces: one homepage introduction link to `https://ktjn.github.io/client-search-framework/gallery/` and a private `RESULT_LIMIT = 4` used by both normal and baseline gallery searches.

- [ ] **Step 1: Add failing browser assertions for homepage placement and result limits**

In the first showcase test group, add:

```ts
test("homepage introduces the live feature gallery", async ({ page }) => {
  await page.goto(`${baseUrl}index.html`);
  await expect(
    page.locator(
      'main > p:first-of-type a[href="https://ktjn.github.io/client-search-framework/gallery/"]',
    ),
  ).toHaveText("Try the live feature gallery");
});
```

In the quick-example group, add:

```ts
test("quick examples render at most four results", async ({ page }) => {
  await page.goto(`${baseUrl}gallery/index.html`);
  const cards = page.locator(".quick-example-card");
  await expect(page.locator(".gallery-loading")).toHaveCount(0);
  for (let index = 0; index < (await cards.count()); index++) {
    expect(await cards.nth(index).locator(".gallery-hit-list li").count()).toBeLessThanOrEqual(4);
  }
});
```

In the product-demo default-load test, replace the non-empty-only assertion with the exact cap:

```ts
await expect(page.locator(".gallery-hit-list li")).toHaveCount(4);
```

Update the facet-filter test so it does not assume the capped count must fall. Capture the links before filtering, then assert the filtered list is non-empty, remains capped, and changes:

```ts
const beforeHrefs = await page.locator(".gallery-hit-list li a").evaluateAll(
  (links) => links.map((link) => link.getAttribute("href")),
);
// check the Furniture facet using the existing locator
await expect(async () => {
  const links = page.locator(".gallery-hit-list li a");
  const afterHrefs = await links.evaluateAll((items) =>
    items.map((item) => item.getAttribute("href")),
  );
  expect(afterHrefs.length).toBeGreaterThan(0);
  expect(afterHrefs.length).toBeLessThanOrEqual(4);
  expect(afterHrefs).not.toEqual(beforeHrefs);
}).toPass();
```

- [ ] **Step 2: Build and run the focused browser tests to verify failure**

Run:

```powershell
pnpm docs:build
pnpm exec playwright test showcase/e2e-browser/showcase.spec.ts --grep "homepage introduces|at most four|default browse-all|checking a category"
```

Expected: the homepage-placement assertion fails because the link is in the later Showcase section, and the gallery assertions fail because the widget requests up to 24 hits.

- [ ] **Step 3: Move the homepage link and implement the fixed limit**

Change the opening README paragraph to:

```markdown
`client-search-framework` builds a static search index ahead of time and searches it in the browser. It provides search-service features without a query-time server, hosted API, or per-query bill. [Try the live feature gallery](https://ktjn.github.io/client-search-framework/gallery/) to see real generated indexes searched by the browser client.
```

Delete the later `## Showcase` heading and paragraph so the homepage has one content link rather than two placements.

Near `siteRoot` in `gallery-widget.ts`, add:

```ts
const RESULT_LIMIT = 4;
```

Replace both `limit: 24` options with:

```ts
limit: RESULT_LIMIT,
```

- [ ] **Step 4: Rebuild and verify the focused browser tests pass**

Run:

```powershell
pnpm docs:build
pnpm exec playwright test showcase/e2e-browser/showcase.spec.ts --grep "homepage introduces|at most four|default browse-all|checking a category"
```

Expected: all selected tests pass; every rendered gallery list has zero to four entries and the homepage introduction contains the live link.

- [ ] **Step 5: Commit the showcase change**

```powershell
git add README.md showcase/src/gallery-widget.ts showcase/e2e-browser/showcase.spec.ts
git commit -m "feat(showcase): cap gallery results at four"
```

---

### Task 2: Share SymSpell deletion generation through analysis

**Files:**
- Create: `packages/analysis/src/generate-deletes.ts`
- Create: `packages/analysis/test/generate-deletes.test.ts`
- Modify: `packages/analysis/src/index.ts`
- Modify: `packages/client/src/search.ts`
- Modify: `packages/indexer/src/build-index.ts`

**Interfaces:**
- Consumes: a Unicode string and `maxEdits: 1 | 2`.
- Produces: `generateDeletes(term: string, maxEdits: 1 | 2): string[]`, containing the original term and every unique code-point deletion reachable through the requested depth.

- [ ] **Step 1: Write the focused helper tests before creating the implementation**

Create `packages/analysis/test/generate-deletes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { generateDeletes } from "../src/index.js";

describe("generateDeletes", () => {
  it("includes the term and every unique one-code-point deletion", () => {
    expect(new Set(generateDeletes("cat", 1))).toEqual(
      new Set(["cat", "at", "ct", "ca"]),
    );
  });

  it("walks deletion-of-deletion variants at edit distance two", () => {
    expect(new Set(generateDeletes("cat", 2))).toEqual(
      new Set(["cat", "at", "ct", "ca", "a", "t", "c"]),
    );
  });

  it("deletes Unicode code points without splitting surrogate pairs", () => {
    expect(new Set(generateDeletes("a😀", 1))).toEqual(
      new Set(["a😀", "😀", "a"]),
    );
  });

  it("deduplicates repeated-character variants", () => {
    expect(generateDeletes("aa", 1)).toEqual(["aa", "a"]);
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
pnpm --filter @csf/analysis test -- generate-deletes.test.ts
```

Expected: FAIL because `generateDeletes` is not exported.

- [ ] **Step 3: Add the minimal shared implementation and export**

Create `packages/analysis/src/generate-deletes.ts`:

```ts
/** Return every unique Unicode code-point deletion through `maxEdits`. */
export function generateDeletes(term: string, maxEdits: 1 | 2): string[] {
  let frontier = new Set([term]);
  const all = new Set(frontier);
  for (let depth = 0; depth < maxEdits; depth++) {
    const next = new Set<string>();
    for (const variant of frontier) {
      const chars = [...variant];
      for (let index = 0; index < chars.length; index++) {
        next.add(chars.slice(0, index).join("") + chars.slice(index + 1).join(""));
      }
    }
    for (const variant of next) all.add(variant);
    frontier = next;
  }
  return [...all];
}
```

Add to `packages/analysis/src/index.ts`:

```ts
export { generateDeletes } from "./generate-deletes.js";
```

- [ ] **Step 4: Verify the helper tests pass**

Run:

```powershell
pnpm --filter @csf/analysis test -- generate-deletes.test.ts
```

Expected: four tests pass.

- [ ] **Step 5: Replace both private copies with the shared import**

Add `generateDeletes` to the existing `@csf/analysis` imports in:

```ts
// packages/client/src/search.ts
import {
  generateDeletes,
  getLanguageProfile,
  normalizePhrase,
  ownProp,
} from "@csf/analysis";
```

```ts
// packages/indexer/src/build-index.ts
import {
  analyze,
  generateDeletes,
  getLanguageProfile,
  getOrCreate,
  normalizePhrase,
  ownProp,
} from "@csf/analysis";
```

Delete each local `generateDeletes` function and its duplication rationale. Keep the indexer/query-specific comments on the call sites or fuzzy-shard construction where they explain behavior rather than ownership.

- [ ] **Step 6: Run focused analysis, client, and indexer tests**

Run:

```powershell
pnpm --filter @csf/analysis test
pnpm --filter @csf/indexer test -- build-index.test.ts
pnpm --filter @csf/client test -- e2e.test.ts
pnpm --filter @csf/analysis typecheck
pnpm --filter @csf/indexer typecheck
pnpm --filter @csf/client typecheck
```

Expected: all selected tests and type checks pass. If a known Windows-only baseline test fails, compare it to the recorded four failures before classifying it.

- [ ] **Step 7: Commit the shared helper**

```powershell
git add packages/analysis/src/generate-deletes.ts packages/analysis/src/index.ts packages/analysis/test/generate-deletes.test.ts packages/client/src/search.ts packages/indexer/src/build-index.ts
git commit -m "refactor: share fuzzy deletion generation"
```

---

### Task 3: Remove implementation-only exports and dependency metadata

**Files:**
- Modify: `packages/client/src/parse-query.ts`
- Modify: `packages/indexer/src/write-index.ts`
- Modify: `showcase/gallery-data.ts`
- Modify: `showcase/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: existing private uses of `PhraseTerm`, `DEFAULT_MAX_TERM_SHARD_GZIP_BYTES`, and `priceBucketFor`.
- Produces: the same runtime values with no exported declaration for those implementation details; showcase dependency metadata containing only packages resolved through source imports.

- [ ] **Step 1: Reconfirm that the symbols and dependency have no source consumers**

Run:

```powershell
rg -n "PhraseTerm|DEFAULT_MAX_TERM_SHARD_GZIP_BYTES|priceBucketFor" . --glob '!node_modules/**' --glob '!dist/**'
rg -n 'from "@csf/client"|import\("@csf/client"' showcase --glob '!dist/**'
```

Expected: each symbol is used only in its defining module (documentation may mention the constant by name), and `@csf/client` appears only inside rendered example source strings rather than as a build-time import. The widget dynamically loads `showcase/dist/assets/index.js`, copied from `packages/client/dist` by `build-search.ts`.

- [ ] **Step 2: Make the three declarations module-private**

Apply these exact declaration changes:

```ts
interface PhraseTerm {
```

```ts
const DEFAULT_MAX_TERM_SHARD_GZIP_BYTES = 50 * 1024;
```

```ts
function priceBucketFor(price: number): string {
```

Do not rename them or alter their call sites.

- [ ] **Step 3: Remove the unused showcase workspace dependency**

Run:

```powershell
pnpm --filter showcase remove --save-dev @csf/client
```

Expected: `showcase/package.json` no longer lists `@csf/client`, and `pnpm-lock.yaml` updates without changing runtime dependencies.

- [ ] **Step 4: Run compiler-backed and dead-export checks**

Run:

```powershell
pnpm typecheck
pnpm dlx knip --reporter compact
```

Expected: type checks pass. Knip no longer reports the three unused exports or the showcase `@csf/client` dev dependency. Its known intentional reports may remain: explicit widget TypeScript entry files, the manual specification example, and the external `uv` binary used by conformance tests.

- [ ] **Step 5: Commit the export and dependency cleanup**

```powershell
git add packages/client/src/parse-query.ts packages/indexer/src/write-index.ts showcase/gallery-data.ts showcase/package.json pnpm-lock.yaml
git commit -m "refactor: hide implementation-only symbols"
```

---

### Task 4: Delete completed binary investigations and repair references

**Files:**
- Delete: `packages/indexer/bench/binary-vs-json-postings.mjs`
- Delete: `packages/indexer/bench/binary-lazy-decode.mjs`
- Modify: `packages/indexer/package.json`
- Modify: `packages/indexer/src/binary-term-shard.ts`
- Modify: `packages/indexer/src/binary-fuzzy-shard.ts`
- Modify: `packages/indexer/src/write-index.ts`
- Modify: `packages/client/src/binary-term-shard.ts`
- Modify: `packages/client/src/search.ts`
- Modify: `docs/archive/investigations/binary-vs-json-index.md`
- Modify: `docs/archive/roadmaps/implementation-history.md`

**Interfaces:**
- Consumes: the archived binary investigation conclusions and retained `pnpm bench` JSON-tier scaling command.
- Produces: no executable commands for retired prototypes, no live-source references to deleted paths, and one retained scale benchmark.

- [ ] **Step 1: Capture the retained benchmark smoke before deletion**

Run a small corpus through the supported benchmark:

```powershell
$env:CSF_BENCH_SIZES='1000'
pnpm bench
Remove-Item Env:CSF_BENCH_SIZES
```

Expected: `json-tier-scaling.mjs` completes and prints metrics for 1,000 documents.

- [ ] **Step 2: Remove retired scripts and files**

Delete `bench:binary` and `bench:binary-lazy` from `packages/indexer/package.json`, leaving:

```json
"bench": "node bench/json-tier-scaling.mjs"
```

Delete both completed binary benchmark files. Use `apply_patch` for all deletions.

- [ ] **Step 3: Replace stale source references with the archived conclusion**

In the five affected production files, replace references to
`packages/indexer/bench/binary-lazy-decode.mjs` with the stable documentation
path `docs/archive/investigations/binary-vs-json-index.md`. Preserve only the
short behavioral point relevant to the code: directory metadata enables lazy
per-term decode without decoding the entire shard.

In `packages/client/src/search.ts`, reduce the inline benchmark-specific comment to:

```ts
// Binary directories expose per-term offsets, so decode only matched entries.
```

- [ ] **Step 4: Mark historical commands as retired in the archive**

In `docs/archive/investigations/binary-vs-json-index.md` and
`docs/archive/roadmaps/implementation-history.md`, retain the recorded findings
but replace runnable-command language for the two deleted scripts with a short
historical note:

```markdown
The one-off benchmark program was removed after the investigation concluded;
the measurements and decision record remain here, and the shipped codecs are
covered by package tests.
```

Do not change references to `json-tier-scaling.mjs` or `pnpm bench` because that
benchmark remains supported.

- [ ] **Step 5: Prove no active references or commands remain**

Run:

```powershell
rg -n "binary-vs-json-postings|binary-lazy-decode|bench:binary" packages README.md docs --glob '!docs/superpowers/**'
```

Expected: no production/package reference remains. Archive prose may retain the benchmark names only when clearly described as historical and removed; no deleted relative link or runnable command remains.

- [ ] **Step 6: Re-run the retained benchmark and indexer tests**

Run:

```powershell
$env:CSF_BENCH_SIZES='1000'
pnpm bench
Remove-Item Env:CSF_BENCH_SIZES
pnpm --filter @csf/indexer test
```

Expected: the scale benchmark completes and indexer tests pass.

- [ ] **Step 7: Commit the retired investigation cleanup**

```powershell
git add packages/indexer/package.json packages/indexer/bench packages/indexer/src packages/client/src docs/archive/investigations/binary-vs-json-index.md docs/archive/roadmaps/implementation-history.md
git commit -m "chore: retire completed binary investigations"
```

---

### Task 5: Run the full simplification and publishing gates

**Files:**
- Modify only if a verification failure exposes a regression caused by Tasks 1-4.

**Interfaces:**
- Consumes: all prior task commits.
- Produces: verified packages, showcase, Pages artifact, and recorded evidence of net reduction.

- [ ] **Step 1: Check formatting and repository cleanliness**

Run:

```powershell
git diff --check main...HEAD
pnpm lint
git status --short
```

Expected: no whitespace errors, Biome passes, and no generated `dist/` files are tracked or left as unexpected changes.

- [ ] **Step 2: Run complete type, build, test, and bundle gates**

Run:

```powershell
pnpm typecheck
pnpm build
pnpm test
pnpm size
```

Expected: type checking, builds, and bundle-size checks pass. Compare any test failure with the four recorded Windows-only baseline failures; investigate every other failure before continuing.

- [ ] **Step 3: Run the complete publishing gate**

Run:

```powershell
pnpm docs:check
```

Expected: static documentation build and validation pass, showcase Vitest tests pass, and all Playwright browser tests pass.

- [ ] **Step 4: Re-run static cleanup evidence**

Run:

```powershell
pnpm dlx knip --reporter compact
pnpm dlx jscpd packages showcase --min-lines 12 --min-tokens 90 --reporters console --exit-code 0 --ignore '**/dist/**,**/test/**,**/e2e-browser/**,**/*.d.ts'
```

Expected: no new actionable dead-code report; the production `generateDeletes` clone and binary benchmark clones are gone. Intentional entry-point and external-tool reports are documented rather than “fixed” with artificial imports.

- [ ] **Step 5: Measure the net reduction**

Run:

```powershell
$files = git ls-files 'packages/**' 'showcase/**' | Where-Object { $_ -match '\.(ts|mjs)$' -and $_ -notmatch '(^|/)(test|e2e-browser)/' -and $_ -notmatch '\.d\.ts$' }
$lines = 0
foreach ($file in $files) { $lines += (Get-Content $file | Measure-Object -Line).Lines }
$exports = (rg -n '^export (type |interface |class |const |function |\{)' packages showcase --glob '*.ts' --glob '!**/dist/**' | Measure-Object -Line).Lines
"FILES=$($files.Count) LINES=$lines EXPORT_DECLARATIONS=$exports"
```

Expected: fewer than 77 production-like files, materially fewer than 10,922 lines, and fewer than 196 export declarations after accounting for the one intentional shared `generateDeletes` export.

- [ ] **Step 6: Run the mandatory documentation review**

Apply the `doc-review` skill to every changed file under `docs/` and report all four phases. Expected: structural validation, cross-reference consistency, coverage completeness, and quality gates all pass. No ADR update is needed unless Task 3 removed a root-package barrel export.

- [ ] **Step 7: Inspect the final diff for accidental scope expansion**

Run:

```powershell
git diff --stat main...HEAD
git diff --name-status main...HEAD
git log --oneline --decorate main..HEAD
```

Expected: only the files named in this plan changed, deletions dominate additions outside tests and planning documents, and each task has one focused commit.
