# Documentation and Showcase Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat, planning-heavy public documentation with an audience-first site, a guided interactive showcase, and a locally reproducible GitHub Pages validation gate.

**Architecture:** Keep the existing custom Markdown-to-static-HTML build and real `@ktjn/searchable-indexer`/`@ktjn/searchable-client` demos. Add an explicit typed navigation manifest, small testable rendering/validation modules, and a typed showcase-example catalog that drives both runtime data attributes and displayed source. Historical material remains in git under unpublished archive directories.

**Tech Stack:** TypeScript 7, Node.js 22, pnpm 11, marked, highlight.js (build-time only), Vitest, Playwright, GitHub Pages Actions.

## Global Constraints

- Preserve the pull-based static HTTP deployment model and custom site generator; do not introduce a documentation framework.
- Publish only pages explicitly listed in the navigation manifest.
- Exclude `docs/archive/` and `docs/superpowers/` from rendered output and the docs search index.
- Keep every interactive result backed by a real generated index and `@ktjn/searchable-client`; do not mock results.
- Derive visible inline example code from the same typed definition that supplies runtime widget configuration.
- Keep all generated URLs relative and valid when hosted below `/client-search-framework/`.
- Do not preserve the numbered documentation URLs with redirect stubs.
- Keep package publishing separate from Pages publishing; both continue to use the browser suite as a gate.

---

## File structure

### Documentation sources

- `README.md`: concise repository landing page only.
- `docs/getting-started/*.md`: overview, installation, and first successful search.
- `docs/guides/*.md`: task-oriented indexing and feature guides.
- `docs/concepts/*.md`: architecture and storage explanations.
- `docs/reference/*.md`: current API and configuration contracts only.
- `docs/project/*.md`: current roadmap, governance, and ADR index.
- `docs/adr/*.md`: existing durable decisions, unchanged except for repaired links.
- `docs/archive/investigations/*.md`: completed research retained for history.
- `docs/archive/roadmaps/*.md`: completed and superseded plans retained for history.
- `docs/archive/specs/*.md`: unimplemented or superseded draft specifications.

### Site implementation

- `showcase/docs-nav.ts`: typed, ordered publication manifest.
- `showcase/docs-site.ts`: pure manifest validation, Markdown-link rewriting, navigation, and page-shell helpers.
- `showcase/build-docs.ts`: filesystem orchestration only.
- `showcase/site-validation.ts`: pure generated-artifact validation.
- `showcase/validate-dist.ts`: CLI wrapper for artifact validation.
- `showcase/quick-examples.ts`: typed quick-example catalog and code generation.
- `showcase/build-gallery-index.ts`: renders the showcase landing page from the catalog.
- `showcase/src/gallery-widget.ts`: shared live example widget with explicit loading/error states.
- `showcase/src/style.css`, `showcase/src/gallery.css`: grouped navigation, responsive layout, example cards, and code presentation.
- `showcase/test/docs-site.test.ts`: manifest and route unit tests.
- `showcase/test/site-validation.test.ts`: link, asset, fragment, and exclusion unit tests.
- `showcase/test/quick-examples.test.ts`: catalog/runtime/source consistency tests.
- `showcase/e2e-browser/showcase.spec.ts`: new routes, mobile navigation, quick examples, and source disclosure.
- `showcase/vitest.config.ts`: showcase unit-test project.

---

### Task 1: Reorganize and consolidate the documentation corpus

**Files:**
- Rewrite: `README.md`
- Create: `docs/getting-started/overview.md`
- Create: `docs/getting-started/installation.md`
- Create: `docs/getting-started/first-search.md`
- Create: `docs/guides/indexing.md`
- Create: `docs/guides/ranking-and-boosts.md`
- Create: `docs/guides/facets.md`
- Create: `docs/guides/synonyms.md`
- Create: `docs/guides/pinning.md`
- Create: `docs/guides/internationalization.md`
- Create: `docs/guides/offline-search.md`
- Create: `docs/guides/vector-search.md`
- Create: `docs/concepts/architecture.md`
- Create: `docs/concepts/index-format.md`
- Create: `docs/concepts/binary-storage.md`
- Create: `docs/reference/client-api.md`
- Create: `docs/reference/configuration.md`
- Create: `docs/reference/cms-meta-tags.md`
- Create: `docs/reference/compatibility.md`
- Create: `docs/project/roadmap.md`
- Create: `docs/project/governance.md`
- Create: `docs/project/architecture-decisions.md`
- Move/archive/delete: all current top-level `docs/*.md` files according to the matrix below
- Modify: repository files returned by the old-path audit command in Step 5

**Interfaces:**
- Produces: the canonical Markdown paths consumed by `DOC_SECTIONS` in Task 2.
- Preserves: existing package behavior, schemas, ADRs, code examples, and historical material.

#### Migration matrix

| Existing file | Disposition | Canonical destination |
|---|---|---|
| `00-overview.md` | Split and rewrite | `getting-started/overview.md`, `installation.md`, `first-search.md` |
| `01-architecture.md` | Merge | `concepts/architecture.md` |
| `02-index-format.md` | Rewrite | `concepts/index-format.md` |
| `03-tokenization-i18n.md` | Rewrite | `guides/internationalization.md` |
| `04-query-ranking-boosts.md` | Rewrite | `guides/ranking-and-boosts.md` |
| `05-synonyms.md` | Rewrite | `guides/synonyms.md` |
| `06-faceted-search.md` | Rewrite | `guides/facets.md` |
| `07-client-api.md` | Keep implemented surface only | `reference/client-api.md`; archive target-only API prose in `archive/specs/client-api-target.md` |
| `08-modern-features.md` | Split | `concepts/architecture.md`, `guides/offline-search.md`, `reference/client-api.md`, `project/roadmap.md` |
| `09-roadmap.md` | Condense current status | `project/roadmap.md`; detailed completed phases to `archive/roadmaps/implementation-history.md` |
| `10-testing-and-performance.md` | Merge | `project/governance.md` |
| `11-binary-vs-json-index.md` | Archive investigation; retain outcome | `archive/investigations/binary-vs-json-index.md`, `concepts/binary-storage.md` |
| `12-competitive-landscape.md` | Archive research; retain open actions | `archive/investigations/competitive-landscape.md`, `project/roadmap.md` |
| `13-vector-and-hybrid-search.md` | Rewrite current behavior | `guides/vector-search.md` |
| `14-reference-deployment-cms-2k.md` | Merge | `guides/indexing.md`, `reference/configuration.md` |
| `15-cms-meta-tag-control.md` | Rewrite | `reference/cms-meta-tags.md` |
| `16-term-to-page-pinning.md` | Rewrite | `guides/pinning.md` |
| `17-plugin-architecture.md` | Archive unimplemented design | `archive/specs/plugin-architecture.md`; remaining work in `project/roadmap.md` |
| `18-resource-aware-loading.md` | Merge current guidance; archive proposals | `guides/offline-search.md`, `archive/specs/resource-aware-loading.md` |
| `19-github-pages-showcase.md` | Archive completed staging plan | `archive/roadmaps/github-pages-showcase.md`; user guidance moves to showcase landing page |
| `20-tech-stack.md` | Merge | `concepts/architecture.md`, `project/governance.md` |
| `21-architecture-principles.md` | Merge | `concepts/architecture.md` |
| `22-project-governance.md` | Rewrite | `project/governance.md` |
| `23-implementation-roadmap.md` | Merge and archive | `project/roadmap.md`, `archive/roadmaps/specification-roadmap.md` |
| `24-architecture-recommendations.md` | Merge and archive | `project/roadmap.md`, `archive/roadmaps/architecture-recommendations.md` |
| `25-path-to-1.0.md` | Merge current gates; archive iteration history | `reference/compatibility.md`, `project/roadmap.md`, `archive/roadmaps/path-to-1.0.md` |
| `26-example-configurations.md` | Rewrite | `reference/configuration.md` |
| `spec-benchmarking.md` | Merge policy; archive draft | `project/governance.md`, `archive/specs/benchmarking.md` |
| `spec-binary-format.md` | Merge implemented contract; archive draft | `concepts/binary-storage.md`, `archive/specs/binary-format.md` |
| `spec-diagnostics.md` | Archive unimplemented draft | `archive/specs/diagnostics.md`; remaining work in `project/roadmap.md` |
| `spec-plugin-api.md` | Archive unimplemented draft | `archive/specs/plugin-api.md`; remaining work in `project/roadmap.md` |
| `spec-query-planner.md` | Archive unimplemented draft | `archive/specs/query-planner.md`; remaining work in `project/roadmap.md` |
| `spec-storage-api.md` | Archive unimplemented draft | `archive/specs/storage-api.md`; remaining work in `project/roadmap.md` |

- [ ] **Step 1: Create the new directories and move archival source documents**

Use `git mv` for history-preserving moves. Do not copy a file and leave its old numbered version behind.

```powershell
New-Item -ItemType Directory -Force docs/getting-started, docs/guides, docs/concepts, docs/reference, docs/project, docs/archive/investigations, docs/archive/roadmaps, docs/archive/specs | Out-Null
git mv docs/11-binary-vs-json-index.md docs/archive/investigations/binary-vs-json-index.md
git mv docs/12-competitive-landscape.md docs/archive/investigations/competitive-landscape.md
git mv docs/09-roadmap.md docs/archive/roadmaps/implementation-history.md
git mv docs/17-plugin-architecture.md docs/archive/specs/plugin-architecture.md
git mv docs/19-github-pages-showcase.md docs/archive/roadmaps/github-pages-showcase.md
git mv docs/23-implementation-roadmap.md docs/archive/roadmaps/specification-roadmap.md
git mv docs/24-architecture-recommendations.md docs/archive/roadmaps/architecture-recommendations.md
git mv docs/25-path-to-1.0.md docs/archive/roadmaps/path-to-1.0.md
git mv docs/spec-benchmarking.md docs/archive/specs/benchmarking.md
git mv docs/spec-binary-format.md docs/archive/specs/binary-format.md
git mv docs/spec-diagnostics.md docs/archive/specs/diagnostics.md
git mv docs/spec-plugin-api.md docs/archive/specs/plugin-api.md
git mv docs/spec-query-planner.md docs/archive/specs/query-planner.md
git mv docs/spec-storage-api.md docs/archive/specs/storage-api.md
```

- [ ] **Step 2: Write the getting-started path and concise README**

The first-search page must contain one copyable path using only implemented exports:

```ts
import { SearchClient } from "@ktjn/searchable-client";

const search = new SearchClient({
  indexUrl: "/search-index/manifest.json",
  worker: true,
  workerUrl: new URL("/assets/worker.js", location.href),
});

const result = await search.search("getting started");
for (const hit of result.hits) {
  console.log(hit.fields.title, hit.url);
}
```

Installation must show the published npm packages as the default path:

```bash
pnpm add @ktjn/searchable-client
pnpm add -D @ktjn/searchable-indexer
```

The indexing guide may show the repository-local Python reference implementation, but must not imply that `csf-indexer` is published to PyPI. Use the checked-out project explicitly:

```bash
uv run --project python/csf-indexer csf-indexer ./dist/site ./dist/site/search-index
```

README sections, in order: `Why client-search-framework`, `What it supports`, `Quick start`, `Documentation`, `Showcase`, `Development`, `Status`, `License`. Keep the README under 250 lines.

- [ ] **Step 3: Write guides, concepts, reference pages, and project pages**

Each page begins with a one-paragraph purpose statement, describes shipped behavior first, and links planned behavior only through `project/roadmap.md`. Preserve exact public types and configuration names from the current code. The roadmap starts with a compact table:

```markdown
| Area | Current state | Remaining work |
|---|---|---|
| Lexical search | Stable | Query-planner abstraction |
| Facets, synonyms, fuzzy search, and pins | Stable | No required 1.0 work |
| Internationalization | English and German profiles; fallback segmenters | Additional language profiles |
| Offline and worker execution | Stable | Resource-aware loading refinements |
| Binary storage | Term, fuzzy, and document-store codecs | Evaluate remaining shard formats from evidence |
| Vector and hybrid search | Storage, similarity, and local embeddings implemented | Public semantic showcase |
| Extensibility and diagnostics | Draft designs archived | Implement only with a concrete consumer |
```

`project/architecture-decisions.md` links all five existing ADR files and gives each a one-sentence decision summary. `reference/compatibility.md` distinguishes package semver, index format compatibility, and the current `1.0.0` package API.

- [ ] **Step 4: Remove the now-merged numbered source files**

After their canonical pages contain the current material, delete the remaining old top-level sources:

```powershell
git rm docs/00-overview.md docs/01-architecture.md docs/02-index-format.md docs/03-tokenization-i18n.md docs/04-query-ranking-boosts.md docs/05-synonyms.md docs/06-faceted-search.md docs/07-client-api.md docs/08-modern-features.md docs/10-testing-and-performance.md docs/13-vector-and-hybrid-search.md docs/14-reference-deployment-cms-2k.md docs/15-cms-meta-tag-control.md docs/16-term-to-page-pinning.md docs/18-resource-aware-loading.md docs/20-tech-stack.md docs/21-architecture-principles.md docs/22-project-governance.md docs/26-example-configurations.md
```

Create `docs/archive/specs/client-api-target.md` and `docs/archive/specs/resource-aware-loading.md` only from target-only sections that are not already present in another archived spec; do not manufacture duplicate archive prose.

- [ ] **Step 5: Update old documentation-path references repository-wide**

Run:

```powershell
rg -n "docs/(0[0-9]|1[0-9]|2[0-6])-|\((0[0-9]|1[0-9]|2[0-6])-.*\.md" -g '!docs/archive/**' -g '!docs/superpowers/**'
```

Apply these canonical mappings to code comments, tests, schemas, package metadata, `CHANGELOG.md`, showcase code, and `spec/examples/README.md`:

```text
02 -> docs/concepts/index-format.md
03 -> docs/guides/internationalization.md
04 -> docs/guides/ranking-and-boosts.md
05 -> docs/guides/synonyms.md
06 -> docs/guides/facets.md
07 -> docs/reference/client-api.md
08 caching/offline -> docs/guides/offline-search.md
08 worker/architecture -> docs/concepts/architecture.md
08 API/a11y/observability -> docs/reference/client-api.md
09 -> docs/project/roadmap.md
13 -> docs/guides/vector-search.md
14 -> docs/guides/indexing.md
15 -> docs/reference/cms-meta-tags.md
16 -> docs/guides/pinning.md
18 -> docs/guides/offline-search.md
20/21 -> docs/concepts/architecture.md
22 -> docs/project/governance.md
26 -> docs/reference/configuration.md
```

Expected: the audit command prints no non-archive/non-superpowers matches.

- [ ] **Step 6: Validate the content-only migration**

```powershell
rg -n "\b(TODO|TBD)\b" README.md docs/getting-started docs/guides docs/concepts docs/reference docs/project
rg -n "docs/(0[0-9]|1[0-9]|2[0-6])-|\((0[0-9]|1[0-9]|2[0-6])-.*\.md" -g '!docs/archive/**' -g '!docs/superpowers/**'
git diff --check
```

Expected: both `rg` commands return no matches and `git diff --check` exits 0.

- [ ] **Step 7: Commit the documentation migration**

```bash
git add README.md CHANGELOG.md docs packages python showcase spec
git commit -m "docs: reorganize public documentation"
```

---

### Task 2: Add a curated manifest and nested site rendering

**Files:**
- Create: `showcase/docs-nav.ts`
- Create: `showcase/docs-site.ts`
- Create: `showcase/test/docs-site.test.ts`
- Create: `showcase/vitest.config.ts`
- Modify: `showcase/build-docs.ts`
- Modify: `showcase/package.json`
- Modify: `vitest.config.ts`
- Modify: `showcase/src/style.css`

**Interfaces:**
- Produces: `DOC_SECTIONS: readonly DocSection[]`, `flattenNavigation()`, `validateNavigation()`, `rewriteMarkdownLinks()`, `highlightCode()`, and `renderSitePage()`.
- Consumes: canonical Markdown files from Task 1.

- [ ] **Step 1: Write failing manifest and nested-route tests**

```ts
import { describe, expect, test } from "vitest";
import { DOC_SECTIONS } from "../docs-nav.js";
import {
  flattenNavigation,
  rewriteMarkdownLinks,
  validateNavigation,
} from "../docs-site.js";

describe("documentation navigation", () => {
  test("publishes the approved sections in order", () => {
    expect(DOC_SECTIONS.map((section) => section.title)).toEqual([
      "Getting started",
      "Guides",
      "Concepts",
      "Reference",
      "Project",
    ]);
  });

  test("contains no archived or internal source", () => {
    const pages = flattenNavigation(DOC_SECTIONS);
    expect(pages.some((page) => /archive|superpowers/.test(page.source))).toBe(false);
  });

  test("rejects duplicate routes", () => {
    const invalid = [
      { title: "A", pages: [
        { source: "docs/a.md", route: "docs/a", title: "A" },
        { source: "docs/b.md", route: "docs/a", title: "B" },
      ] },
    ];
    expect(() => validateNavigation(invalid)).toThrow("Duplicate documentation route: docs/a");
  });

  test("rewrites sibling and parent Markdown links for nested output", () => {
    expect(rewriteMarkdownLinks('<a href="../reference/client-api.md#search">API</a>'))
      .toBe('<a href="../reference/client-api.html#search">API</a>');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm exec vitest run --config showcase/vitest.config.ts showcase/test/docs-site.test.ts`

Expected: FAIL because the manifest and helpers do not exist.

- [ ] **Step 3: Implement the typed manifest**

```ts
export interface DocPage {
  source: string;
  route: string;
  title: string;
}

export interface DocSection {
  title: string;
  pages: readonly DocPage[];
}

export const DOC_SECTIONS: readonly DocSection[] = [
  { title: "Getting started", pages: [
    { source: "docs/getting-started/overview.md", route: "docs/getting-started/overview", title: "Overview" },
    { source: "docs/getting-started/installation.md", route: "docs/getting-started/installation", title: "Installation" },
    { source: "docs/getting-started/first-search.md", route: "docs/getting-started/first-search", title: "Your first search" },
  ] },
  { title: "Guides", pages: [
    ["indexing", "Indexing content"], ["ranking-and-boosts", "Ranking and boosts"],
    ["facets", "Faceted search"], ["synonyms", "Synonyms"], ["pinning", "Pinned results"],
    ["internationalization", "Internationalization"], ["offline-search", "Offline search"],
    ["vector-search", "Vector and hybrid search"],
  ].map(([name, title]) => ({ source: `docs/guides/${name}.md`, route: `docs/guides/${name}`, title })) },
  { title: "Concepts", pages: [
    ["architecture", "Architecture"], ["index-format", "Index format"], ["binary-storage", "Binary storage"],
  ].map(([name, title]) => ({ source: `docs/concepts/${name}.md`, route: `docs/concepts/${name}`, title })) },
  { title: "Reference", pages: [
    ["client-api", "Client API"], ["configuration", "Configuration"],
    ["cms-meta-tags", "CMS meta tags"], ["compatibility", "Compatibility"],
  ].map(([name, title]) => ({ source: `docs/reference/${name}.md`, route: `docs/reference/${name}`, title })) },
  { title: "Project", pages: [
    ...[
      ["roadmap", "Roadmap"], ["governance", "Governance"],
      ["architecture-decisions", "Architecture decisions"],
    ].map(([name, title]) => ({ source: `docs/project/${name}.md`, route: `docs/project/${name}`, title })),
    ...[
      ["0001-pull-based-static-http", "ADR-0001: Pull-based static HTTP"],
      ["0002-json-first-index-format", "ADR-0002: JSON-first index format"],
      ["0003-bm25f-ranking-model", "ADR-0003: BM25F ranking model"],
      ["0004-compatibility-policy", "ADR-0004: Compatibility policy"],
      ["0005-plugin-opt-in-boundary", "ADR-0005: Plugin opt-in boundary"],
    ].map(([name, title]) => ({ source: `docs/adr/${name}.md`, route: `docs/adr/${name}`, title })),
  ] },
];
```

- [ ] **Step 4: Implement pure site helpers and refactor `build-docs.ts`**

`validateNavigation()` checks duplicate routes/sources and forbidden directories. `build-docs.ts` additionally checks `access(join(repoRoot, page.source))` so errors include the missing source path. `renderSitePage()` receives the flattened previous/current/next page records and renders grouped navigation plus previous/next links.

```ts
export function flattenNavigation(sections: readonly DocSection[]): DocPage[] {
  return sections.flatMap((section) => section.pages);
}

export function validateNavigation(sections: readonly DocSection[]): void {
  const routes = new Set<string>();
  const sources = new Set<string>();
  for (const page of flattenNavigation(sections)) {
    if (/^docs\/(archive|superpowers)\//.test(page.source)) {
      throw new Error(`Unpublishable documentation source: ${page.source}`);
    }
    if (routes.has(page.route)) throw new Error(`Duplicate documentation route: ${page.route}`);
    if (sources.has(page.source)) throw new Error(`Duplicate documentation source: ${page.source}`);
    routes.add(page.route);
    sources.add(page.source);
  }
}

export function rewriteMarkdownLinks(html: string): string {
  return html.replace(/href="([^"]*?)\.md(#[^"]*)?"/g,
    (_match, path: string, hash = "") => `href="${path}.html${hash}"`);
}
```

Use `highlight.js/lib/core` with only JavaScript, TypeScript, JSON, Bash, and Python registered. Export `highlightCode(language, source)` from `docs-site.ts`, and configure `marked`'s renderer so fenced blocks receive `hljs language-*` classes and highlighted HTML. Do not ship highlight.js to the browser.

- [ ] **Step 5: Add the showcase Vitest project and run tests**

`showcase/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
```

Change root `vitest.config.ts` projects to `['packages/*', 'showcase']`, add `"test": "vitest run"` and `highlight.js` to `showcase/package.json`, then run:

```bash
pnpm install
pnpm exec vitest run --config showcase/vitest.config.ts showcase/test/docs-site.test.ts
pnpm --filter showcase build:docs
```

Expected: tests pass and the build reports 26 curated documentation pages plus the README home page.

- [ ] **Step 6: Commit the manifest-driven site**

```bash
git add pnpm-lock.yaml vitest.config.ts showcase docs
git commit -m "feat(showcase): build curated documentation navigation"
```

---

### Task 3: Validate the generated Pages artifact and wire publishing gates

**Files:**
- Create: `showcase/site-validation.ts`
- Create: `showcase/validate-dist.ts`
- Create: `showcase/test/site-validation.test.ts`
- Modify: `showcase/package.json`
- Modify: `package.json`
- Modify: `.github/workflows/deploy-pages.yml`

**Interfaces:**
- Produces: `validateSite(rootDir: string): Promise<ValidationIssue[]>` and CLI exit status.
- Consumes: fully built `showcase/dist` from Task 2 and existing gallery builders.

- [ ] **Step 1: Write failing artifact-validation tests**

```ts
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import { validateSite } from "../site-validation.js";

test("reports broken local links and fragments", async () => {
  const root = await mkdtemp(join(tmpdir(), "csf-site-"));
  await writeFile(join(root, "index.html"), '<a href="missing.html#nope">broken</a>');
  expect(await validateSite(root)).toEqual([
    { source: "index.html", reference: "missing.html#nope", reason: "missing target" },
  ]);
});

test("accepts nested relative assets and heading fragments", async () => {
  const root = await mkdtemp(join(tmpdir(), "csf-site-"));
  await mkdir(join(root, "docs"));
  await writeFile(join(root, "style.css"), "body {}");
  await writeFile(join(root, "index.html"), '<h1 id="home">Home</h1><a href="docs/a.html#topic">A</a>');
  await writeFile(join(root, "docs/a.html"), '<link rel="stylesheet" href="../style.css"><h2 id="topic">Topic</h2>');
  expect(await validateSite(root)).toEqual([]);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm exec vitest run --config showcase/vitest.config.ts showcase/test/site-validation.test.ts`

Expected: FAIL because `site-validation.ts` does not exist.

- [ ] **Step 3: Implement validation and CLI reporting**

Recursively read `.html` files; extract `href` and `src`; ignore `https:`, `http:`, `mailto:`, and `data:` references; resolve other paths relative to the source document; verify files exist; and verify fragments against `id` attributes in the target HTML. Return sorted issues.

The CLI must also assert that no generated pathname or search-index JSON contains `docs/archive/` or `docs/superpowers/`.

```ts
const issues = await validateSite(distDir);
if (issues.length > 0) {
  for (const issue of issues) {
    console.error(`${issue.source}: ${issue.reference} (${issue.reason})`);
  }
  process.exitCode = 1;
} else {
  console.log("validated generated site: all local links, assets, and fragments resolve");
}
```

- [ ] **Step 4: Add local and CI commands**

Add to `showcase/package.json`:

```json
"validate": "tsx validate-dist.ts",
"check": "pnpm build && pnpm validate && pnpm test"
```

Add to the root `package.json`:

```json
"docs:build": "pnpm build && pnpm --filter showcase build",
"docs:check": "pnpm docs:build && pnpm --filter showcase validate && pnpm exec vitest run --config showcase/vitest.config.ts"
```

In `.github/workflows/deploy-pages.yml`, replace the separate package/showcase build commands with:

```yaml
      - run: pnpm docs:check
      - uses: actions/configure-pages@v6
      - uses: actions/upload-pages-artifact@v5
        with:
          path: showcase/dist
```

- [ ] **Step 5: Run focused validation**

```bash
pnpm exec vitest run --config showcase/vitest.config.ts showcase/test/site-validation.test.ts
pnpm docs:check
```

Expected: unit tests pass; build renders the curated pages; artifact validation prints its success line.

- [ ] **Step 6: Commit publishing validation**

```bash
git add package.json showcase/package.json showcase/site-validation.ts showcase/validate-dist.ts showcase/test/site-validation.test.ts .github/workflows/deploy-pages.yml
git commit -m "ci(docs): validate Pages artifact before deployment"
```

---

### Task 4: Build the guided showcase landing page from typed examples

**Files:**
- Create: `showcase/quick-examples.ts`
- Create: `showcase/test/quick-examples.test.ts`
- Modify: `showcase/build-gallery-index.ts`
- Modify: `showcase/src/gallery.css`

**Interfaces:**
- Produces: `QUICK_EXAMPLES`, `renderRuntimeAttributes()`, and `renderExampleCode()`.
- Consumes: existing product, synonym, and i18n indexes and `gallery-widget.js`.

- [ ] **Step 1: Write failing catalog consistency tests**

```ts
import { expect, test } from "vitest";
import {
  QUICK_EXAMPLES,
  renderExampleCode,
  renderRuntimeAttributes,
} from "../quick-examples.js";

test("contains one unique example for every approved behavior", () => {
  expect(QUICK_EXAMPLES.map((example) => example.id)).toEqual([
    "basic", "fuzzy", "facets", "synonyms", "pinning", "internationalization",
  ]);
});

test("displayed source and runtime attributes derive from one definition", () => {
  for (const example of QUICK_EXAMPLES) {
    const attributes = renderRuntimeAttributes(example);
    const code = renderExampleCode(example);
    expect(attributes).toContain(`data-index-path="${example.indexPath}"`);
    expect(code).toContain(example.indexPath);
    expect(code).toContain(JSON.stringify(example.initialQuery));
  }
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm exec vitest run --config showcase/vitest.config.ts showcase/test/quick-examples.test.ts`

Expected: FAIL because `quick-examples.ts` does not exist.

- [ ] **Step 3: Implement the catalog**

```ts
export interface QuickExample {
  id: string;
  title: string;
  description: string;
  guideHref: string;
  indexPath: string;
  initialQuery: string;
  facets?: readonly string[];
  fuzzy?: boolean;
  synonyms?: boolean;
  languages?: readonly string[];
}

export const QUICK_EXAMPLES: readonly QuickExample[] = [
  { id: "basic", title: "Basic search", description: "Rank real pages from a static index.", guideHref: "../docs/getting-started/first-search.html", indexPath: "gallery/products/search-index/manifest.json", initialQuery: "desk" },
  { id: "fuzzy", title: "Fuzzy matching", description: "Compare a typo with fuzzy matching disabled and enabled.", guideHref: "../docs/guides/ranking-and-boosts.html#fuzzy-matching", indexPath: "gallery/products/search-index/manifest.json", initialQuery: "wirelss", fuzzy: true },
  { id: "facets", title: "Facet filtering", description: "Narrow the product corpus with live category counts.", guideHref: "../docs/guides/facets.html", indexPath: "gallery/products/search-index/manifest.json", initialQuery: "product", facets: ["category"] },
  { id: "synonyms", title: "Synonym expansion", description: "Show results that only appear through a synonym rule.", guideHref: "../docs/guides/synonyms.html", indexPath: "gallery/synonyms/search-index/manifest.json", initialQuery: "sofa", synonyms: true },
  { id: "pinning", title: "Pinned results", description: "Promote a curated best bet above organic results.", guideHref: "../docs/guides/pinning.html", indexPath: "gallery/products/search-index/manifest.json", initialQuery: "returns policy" },
  { id: "internationalization", title: "Internationalized search", description: "Query one multilingual index through language partitions.", guideHref: "../docs/guides/internationalization.html", indexPath: "gallery/i18n/search-index/manifest.json", initialQuery: "espresso", languages: ["en", "de"] },
];
```

`renderRuntimeAttributes()` escapes values and generates the existing `data-gallery-*` contract. `renderExampleCode()` renders a compact `SearchClient` construction and `search()` call using the same index path, query, language, facets, fuzzy, and synonyms values.

- [ ] **Step 4: Render quick cards and full-demo cards**

Replace the gallery hub's single list with:

```html
<section aria-labelledby="quick-examples">
  <h2 id="quick-examples">Try individual features</h2>
  <div class="quick-example-grid">${quickCards}</div>
</section>
<section aria-labelledby="full-demos">
  <h2 id="full-demos">Explore complete demos</h2>
  <ul class="gallery-demo-list">${demoLinks}</ul>
</section>
```

Each quick card includes its real `[data-gallery-root]`, a guide link, and native disclosure markup. Import `highlightCode` from `docs-site.ts` and pass `renderExampleCode(example)` through `highlightCode("typescript", source)` so the visible tokens are highlighted at build time:

```html
<details class="example-source">
  <summary>View source</summary>
  <pre><code class="hljs language-typescript">${highlightedSource}</code></pre>
</details>
```

Load `gallery-widget.js` once through `pageShell({ withWidget: true })`.

- [ ] **Step 5: Style responsive example cards and source disclosure**

Use a one-column mobile grid and `repeat(auto-fit, minmax(20rem, 1fr))` above 48rem. Preserve visible focus rings, allow code blocks to scroll horizontally, and avoid fixed card heights.

- [ ] **Step 6: Run unit tests and build**

```bash
pnpm exec vitest run --config showcase/vitest.config.ts showcase/test/quick-examples.test.ts
pnpm --filter showcase build
pnpm --filter showcase validate
```

Expected: six quick examples and four full-demo links render; artifact validation passes.

- [ ] **Step 7: Commit the showcase catalog**

```bash
git add showcase/quick-examples.ts showcase/build-gallery-index.ts showcase/src/gallery.css showcase/test/quick-examples.test.ts
git commit -m "feat(showcase): add guided interactive examples"
```

---

### Task 5: Harden interactive states and browser coverage

**Files:**
- Modify: `showcase/src/gallery-widget.ts`
- Modify: `showcase/src/gallery.css`
- Modify: `showcase/e2e-browser/showcase.spec.ts`

**Interfaces:**
- Preserves: the existing `[data-gallery-root]` data-attribute contract.
- Adds: `data-example-id`, `.gallery-loading`, `.gallery-error`, and isolated per-root initialization.

- [ ] **Step 1: Write failing Playwright tests for the quick examples**

Add one parameterized smoke test plus unique behavior assertions:

```ts
for (const id of ["basic", "fuzzy", "facets", "synonyms", "pinning", "internationalization"]) {
  test(`quick example ${id} loads real results`, async ({ page }) => {
    await page.goto(`${baseUrl}gallery/index.html`);
    const card = page.locator(`[data-example-card="${id}"]`);
    await expect(card.locator(".gallery-results-summary")).toContainText(/result/);
    await expect(card.locator(".gallery-error")).toHaveCount(0);
  });
}

test("inline source is keyboard-operable and links to its guide", async ({ page }) => {
  await page.goto(`${baseUrl}gallery/index.html`);
  const card = page.locator('[data-example-card="fuzzy"]');
  await card.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(card.locator(".example-source")).toHaveAttribute("open", "");
  await expect(card.locator("pre code")).toContainText("wirelss");
  await expect(card.locator("a.example-guide")).toHaveAttribute("href", /ranking-and-boosts\.html/);
});

test("one broken example does not prevent its siblings from loading", async ({ page }) => {
  await page.route("**/gallery/products/search-index/manifest.json", (route) => route.abort());
  await page.goto(`${baseUrl}gallery/index.html`);
  await expect(page.locator('[data-example-card="basic"] .gallery-error')).toBeVisible();
  await expect(page.locator('[data-example-card="synonyms"] .gallery-results-summary')).toContainText(/result/);
});
```

Update old numbered docs routes in the existing tests to their canonical paths.

- [ ] **Step 2: Run the focused browser tests and verify they fail**

Run: `pnpm test:browser -- --grep "quick example|inline source|broken example"`

Expected: FAIL because the new cards/states are not fully wired.

- [ ] **Step 3: Add explicit isolated widget states**

Wrap each `initGallery(root)` call independently:

```ts
for (const root of galleryRoots) {
  void initGallery(root).catch((error: unknown) => {
    root.replaceChildren();
    const message = document.createElement("p");
    message.className = "gallery-error";
    message.setAttribute("role", "alert");
    message.textContent = "This example could not load. Try refreshing the page.";
    root.append(message);
    console.error("Failed to initialize showcase example", error);
  });
}
```

Before importing the client, render `<p class="gallery-loading" role="status">Loading example</p>`. Replace it with controls/body only after the client is constructed. Add `aria-busy="true"` during searches and reset it in `finally`; render search failures inside only that root.

- [ ] **Step 4: Add responsive/mobile navigation coverage**

Add a mobile project to `playwright.config.ts` using `devices["Pixel 7"]`, or use `page.setViewportSize({ width: 390, height: 844 })` in a focused test if duplicating the entire suite would add unnecessary time. Assert the grouped nav and gallery cards fit without horizontal page overflow; code blocks may scroll internally.

- [ ] **Step 5: Run the focused and existing showcase suites**

```bash
pnpm test:browser -- --grep "showcase|feature gallery|quick example|inline source|broken example|mobile"
```

Expected: all docs search, product, synonym, i18n, quick-example, source, isolation, and mobile tests pass.

- [ ] **Step 6: Commit interactive hardening**

```bash
git add showcase/src/gallery-widget.ts showcase/src/gallery.css showcase/e2e-browser/showcase.spec.ts playwright.config.ts
git commit -m "test(showcase): verify interactive examples and failure states"
```

---

### Task 6: Full documentation and publishing verification

**Files:**
- Modify if needed: documentation, site, tests, or workflow files changed in Tasks 1-5

**Interfaces:**
- Verifies: the exact local artifact and all gates used by Pages and package publishing.

- [ ] **Step 1: Run documentation-specific audits**

```powershell
rg -n "\b(TODO|TBD)\b" README.md docs/getting-started docs/guides docs/concepts docs/reference docs/project
rg -n "docs/(0[0-9]|1[0-9]|2[0-6])-|\((0[0-9]|1[0-9]|2[0-6])-.*\.md" -g '!docs/archive/**' -g '!docs/superpowers/**'
Get-ChildItem showcase/dist -Recurse -File | Select-String -Pattern 'docs/(archive|superpowers)/'
```

Expected: no matches.

- [ ] **Step 2: Run repository quality gates**

```bash
pnpm lint
pnpm typecheck
pnpm size
pnpm test
pnpm docs:check
pnpm test:browser
```

Expected: every command exits 0. Record the Vitest and Playwright test counts in the handoff.

- [ ] **Step 3: Inspect the generated artifact**

Serve `showcase/dist` through the existing test server and inspect:

```text
/index.html
/docs/getting-started/first-search.html
/docs/reference/client-api.html
/docs/project/roadmap.html
/gallery/index.html
/gallery/products/index.html
/gallery/synonyms/index.html
/gallery/i18n/index.html
```

Confirm grouped navigation, previous/next links, highlighted code, six quick examples, four full-demo links, mobile layout, and no archived content.

- [ ] **Step 4: Run the doc/spec review**

Apply the four phases from the repository's `doc-review` skill: structural validation, cross-reference consistency, coverage completeness, and quality gates. Any failure is fixed and the review restarts from Phase 1.

- [ ] **Step 5: Commit final integration fixes only if required**

```bash
git add README.md docs showcase package.json pnpm-lock.yaml playwright.config.ts vitest.config.ts .github/workflows/deploy-pages.yml CHANGELOG.md packages python spec
git commit -m "docs: finish showcase and publishing cleanup"
```

Skip this commit when verification required no fixes.

## Self-review notes

- Every current top-level documentation file has an explicit migration destination.
- Tasks preserve the approved five-section public hierarchy and unpublished archive boundary.
- The existing product, synonym, i18n, and docs-search implementations are reused rather than duplicated.
- Inline code and runtime attributes share a typed source definition.
- Unit tests cover manifest correctness and artifact validation; Playwright covers real behavior and responsive interaction.
- `docs:check` is the local/CI contract, while the full browser suite remains the stronger release gate.
