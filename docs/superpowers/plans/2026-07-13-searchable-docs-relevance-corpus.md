# Searchable Documentation Relevance Corpus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reviewed 20-query relevance corpus that evaluates lexical ranking over the real 28-page generated Searchable documentation index.

**Architecture:** A separate domain-suite schema and loader keep the new documentation corpus additive to the six language baselines. The CLI prepares the showcase only when `--suite searchable-docs` is selected, then a domain runner validates exact URL inventory, serves the generated index over loopback HTTP, queries it through `SearchClient`, and adapts URL-keyed judgments into the existing deterministic metric/report pipeline.

**Tech Stack:** TypeScript 7, Node.js 24, pnpm 11, Vitest 4, existing `@ktjn/searchable-client`, generated showcase index files, JSON fixtures, Biome.

## Global Constraints

- Use the actual generated documentation index under `showcase/dist/search-index`; do not duplicate rendered page bodies in the relevance fixture.
- Include exactly 20 English task-oriented queries and all 28 generated documentation pages.
- At least five queries must have more than one positively judged page.
- Use grades `3` (direct answer), `2` (material help), `1` (supporting context), and `0` or omission (not relevant).
- Require one nonblank rationale for every positive judgment and no rationales for omitted or grade-0 judgments.
- Keep the six existing language fixtures and default `pnpm relevance` output unchanged.
- `--suite` and `--language` are mutually exclusive; suite names resolve only beneath the committed domains fixture directory.
- Normalize result URLs to forward slashes so local Windows evaluation matches GitHub Pages.
- Use lexical mode, `worker: false`, strict manifest validation, and default `k = 5`.
- Add no dependencies, ranking changes, thresholds, CI score gate, release changes, or showcase UI.
- Do not mark judgments reviewed until the maintainer has inspected the query, grade, rationale, and measured-result draft.
- Follow TDD for every production behavior: observe a focused failure before implementing the minimum passing code.
- Before publication, archive this plan and its design under `docs/archive/`; leave no tracked file under `docs/superpowers/`.

---

### Task 1: Domain suite schema and validation

**Files:**
- Create: `packages/relevance/src/domain-schema.ts`
- Create: `packages/relevance/src/validate-domain-suite.ts`
- Test: `packages/relevance/test/validate-domain-suite.test.ts`
- Modify: `packages/relevance/src/index.ts`

**Interfaces:**
- Consumes: `RelevanceGrade`, `SuiteProvenance`, and `SupportedBaselineLanguage` from `schema.ts`.
- Produces: `DomainPage`, `DomainJudgedQuery`, `JudgmentReview`, `DomainRelevanceSuite`, and `validateDomainSuite(value: unknown): DomainRelevanceSuite`.

- [ ] **Step 1: Write the domain model and validator tests first**

Create a minimal valid fixture in `validate-domain-suite.test.ts` and mutate one field per test:

```ts
const validDomainSuite = {
  schemaVersion: 1,
  id: "searchable-docs",
  version: "1.0.0",
  language: "en",
  provenance: {
    publisher: "Searchable contributors",
    sourceTitle: "Searchable documentation",
    sourceUrl: "https://ktjn.github.io/searchable/",
    license: "MIT",
    licenseUrl: "https://github.com/ktjn/searchable/blob/main/LICENSE",
    retrievedAt: "2026-07-13",
    attribution: "Searchable contributors",
    selectionNotes: "All generated documentation pages are included.",
  },
  review: {
    status: "draft",
    method: "Maintainer review of every query, grade, rationale, and result.",
  },
  pages: [
    { id: "/index.html", title: "Searchable" },
    { id: "/docs/guides/offline-search.html", title: "Offline search" },
  ],
  queries: [
    {
      id: "offline-caching",
      text: "keep search working without a network",
      topic: "offline-worker",
      judgments: { "/docs/guides/offline-search.html": 3 },
      rationales: {
        "/docs/guides/offline-search.html":
          "Explains Service Worker registration and index precaching for offline use.",
      },
    },
  ],
};
```

Assert acceptance plus separate failures for duplicate page/query IDs, unsupported language, unknown topic, unknown judged page, no positive judgment, a positive judgment without a rationale, a rationale without a positive judgment, blank rationale, malformed provenance, draft review carrying reviewer/date, and reviewed status missing reviewer/date.

Run: `pnpm exec vitest run packages/relevance/test/validate-domain-suite.test.ts`

Expected: FAIL because `validateDomainSuite` and the domain types do not exist.

- [ ] **Step 2: Define the exact domain model**

Create `domain-schema.ts` with:

```ts
import type {
  RelevanceGrade,
  SuiteProvenance,
  SupportedBaselineLanguage,
} from "./schema.js";

export const DOMAIN_QUERY_TOPICS = [
  "setup",
  "indexing-deployment",
  "lexical-features",
  "internationalization",
  "offline-worker",
  "relevance",
  "vector-hybrid",
] as const;

export type DomainQueryTopic = (typeof DOMAIN_QUERY_TOPICS)[number];

export interface DomainPage {
  id: string;
  title: string;
}

export interface DomainJudgedQuery {
  id: string;
  text: string;
  topic: DomainQueryTopic;
  judgments: Record<string, RelevanceGrade>;
  rationales: Record<string, string>;
}

export type JudgmentReview =
  | { status: "draft"; method: string }
  | {
      status: "reviewed";
      method: string;
      reviewer: string;
      reviewedAt: string;
    };

export interface DomainRelevanceSuite {
  schemaVersion: 1;
  id: string;
  version: string;
  language: SupportedBaselineLanguage;
  provenance: SuiteProvenance;
  review: JudgmentReview;
  pages: DomainPage[];
  queries: DomainJudgedQuery[];
}
```

- [ ] **Step 3: Implement validation minimally**

Create `validate-domain-suite.ts`. Reuse the validation semantics from `validate-suite.ts` without changing baseline validation. Accumulate path-qualified errors beginning `Invalid domain relevance suite:`. Validate:

```ts
const positiveIds = Object.entries(judgments)
  .filter(([, grade]) => Number.isInteger(grade) && Number(grade) >= 1)
  .map(([pageId]) => pageId)
  .sort();
const rationaleIds = Object.keys(rationales).sort();
if (JSON.stringify(positiveIds) !== JSON.stringify(rationaleIds)) {
  errors.push(`query ${id} rationale keys must exactly match positive judgments`);
}
```

Require page IDs to start with `/`, reviewer/date to be absent for `draft`, and reviewer plus a valid `YYYY-MM-DD` date for `reviewed`. Return the original value typed as `DomainRelevanceSuite` only when the error list is empty.

- [ ] **Step 4: Export and verify**

Export the new types/constants/validator from `src/index.ts`.

Run: `pnpm exec vitest run packages/relevance/test/validate-domain-suite.test.ts && pnpm --filter @ktjn/searchable-relevance typecheck`

Expected: all domain validation tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit**

```powershell
git add packages/relevance/src/domain-schema.ts packages/relevance/src/validate-domain-suite.ts packages/relevance/src/index.ts packages/relevance/test/validate-domain-suite.test.ts
git commit -m "feat(relevance): validate domain suites"
```

---

### Task 2: Known-suite loading and CLI selection

**Files:**
- Create: `packages/relevance/src/load-domain-suite.ts`
- Test: `packages/relevance/test/load-domain-suite.test.ts`
- Modify: `packages/relevance/src/cli.ts`
- Test: `packages/relevance/test/cli.test.ts`
- Modify: `packages/relevance/src/index.ts`

**Interfaces:**
- Consumes: `validateDomainSuite` and `DomainRelevanceSuite`.
- Produces: `KNOWN_DOMAIN_SUITES`, `KnownDomainSuite`, `loadDomainSuite(directory, name)`, and `CliOptions.suite?: KnownDomainSuite`.

- [ ] **Step 1: Write failing loader and parser tests**

In `load-domain-suite.test.ts`, write a valid `searchable-docs.json` into a temporary directory and assert:

```ts
expect((await loadDomainSuite(directory, "searchable-docs")).id).toBe(
  "searchable-docs",
);
await expect(loadDomainSuite(directory, "unknown" as never)).rejects.toThrow(
  /unknown domain suite: unknown/,
);
```

Extend `cli.test.ts` with:

```ts
expect(parseCliArgs(["--suite", "searchable-docs", "--json"])).toEqual({
  suite: "searchable-docs",
  k: 5,
  json: true,
});
expect(() =>
  parseCliArgs(["--suite", "searchable-docs", "--language", "en"]),
).toThrow(/mutually exclusive/);
expect(() => parseCliArgs(["--suite", "missing"])).toThrow(
  /unknown domain suite/,
);
```

Run: `pnpm exec vitest run packages/relevance/test/load-domain-suite.test.ts packages/relevance/test/cli.test.ts`

Expected: FAIL because the loader and `--suite` option do not exist.

- [ ] **Step 2: Implement the allowlisted loader**

Create `load-domain-suite.ts`:

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DomainRelevanceSuite } from "./domain-schema.js";
import { validateDomainSuite } from "./validate-domain-suite.js";

export const KNOWN_DOMAIN_SUITES = ["searchable-docs"] as const;
export type KnownDomainSuite = (typeof KNOWN_DOMAIN_SUITES)[number];

export async function loadDomainSuite(
  directory: string,
  name: KnownDomainSuite,
): Promise<DomainRelevanceSuite> {
  if (!KNOWN_DOMAIN_SUITES.includes(name))
    throw new Error(`unknown domain suite: ${name}`);
  const suite = validateDomainSuite(
    JSON.parse(await readFile(join(directory, `${name}.json`), "utf8")),
  );
  if (suite.id !== name)
    throw new Error(`Domain fixture ${name}.json declares id ${suite.id}`);
  return suite;
}
```

- [ ] **Step 3: Extend pure CLI parsing**

Add `suite?: KnownDomainSuite` to `CliOptions`. Parse `--suite` exactly like `--language`, reject missing/unknown values, then perform one post-loop conflict check:

```ts
if (options.suite && options.language)
  throw new Error("--suite and --language are mutually exclusive");
```

Do not change `main` execution in this task.

- [ ] **Step 4: Export, verify, and commit**

Run: `pnpm exec vitest run packages/relevance/test/load-domain-suite.test.ts packages/relevance/test/cli.test.ts && pnpm --filter @ktjn/searchable-relevance typecheck`

Expected: loader and CLI tests pass; the existing default and language parser assertions remain unchanged.

```powershell
git add packages/relevance/src packages/relevance/test/load-domain-suite.test.ts packages/relevance/test/cli.test.ts
git commit -m "feat(relevance): select known domain suites"
```

---

### Task 3: Generated documentation index runner

**Files:**
- Create: `packages/relevance/src/domain-runner.ts`
- Create: `packages/relevance/src/prepare-showcase.ts`
- Test: `packages/relevance/test/domain-runner.test.ts`
- Modify: `packages/relevance/src/index.ts`

**Interfaces:**
- Consumes: `DomainRelevanceSuite`, `evaluateSuite`, `SearchClient`, `serveDirectory`, generated JSON manifest/doc shards.
- Produces: `prepareShowcase()`, `normalizePageId`, `readGeneratedPageInventory`, and `runGeneratedDomainSuite(suite, showcaseDistDirectory, k): Promise<SuiteReport>`.

- [ ] **Step 1: Write failing inventory tests**

Create a temporary `search-index` containing this minimal JSON manifest and doc shard:

```ts
await writeFile(
  join(root, "search-index", "manifest.json"),
  JSON.stringify({
    format: "json",
    shards: { docs: [{ file: "docs/0.json", idRange: [0, 1], shard: 0 }] },
  }),
);
await writeFile(
  join(root, "search-index", "docs", "0.json"),
  JSON.stringify({
    0: { url: "/index.html", fields: { title: "Searchable" } },
    1: {
      url: "/docs\\guides\\offline-search.html",
      fields: { title: "Offline search" },
    },
  }),
);
expect(await readGeneratedPageInventory(root)).toEqual([
  { id: "/docs/guides/offline-search.html", title: "Offline search" },
  { id: "/index.html", title: "Searchable" },
]);
```

Also assert clear failures for missing manifest, non-JSON format, duplicate normalized URLs, malformed doc entries, and exact drift output containing sorted `missing from fixture` and `missing from generated index` URL lists.

Run: `pnpm exec vitest run packages/relevance/test/domain-runner.test.ts`

Expected: FAIL because the domain runner does not exist.

- [ ] **Step 2: Implement inventory reading and comparison**

Implement:

```ts
export function normalizePageId(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}
```

Read `search-index/manifest.json`, require `format === "json"`, read every declared docs shard relative to `search-index`, and collect `{ id: normalizePageId(entry.url), title: entry.fields.title }`. Sort by `id`. Reject duplicates. Compare `suite.pages` to the generated inventory by both ID and title; report both missing sets and title mismatches in one `Documentation corpus drift:` error.

- [ ] **Step 3: Write the failing real-boundary test**

Call the wished-for `prepareShowcase()` in `beforeAll`; it must execute the real
showcase build so a fresh `pnpm test` checkout does not depend on ignored
`showcase/dist` artifacts. Build a two-query test suite whose page inventory
comes from `readGeneratedPageInventory(showcaseDist)` and assert:

```ts
const report = await runGeneratedDomainSuite(suite, showcaseDist, 5);
expect(report.queries.find((query) => query.id === "offline")?.returnedIds[0])
  .toBe("/docs/guides/offline-search.html");
expect(report.queries.find((query) => query.id === "vector")?.returnedIds[0])
  .toBe("/docs/guides/vector-search.html");
```

Run: `pnpm --filter showcase build && pnpm exec vitest run packages/relevance/test/domain-runner.test.ts`

Expected: inventory tests pass, but the integration assertion FAILS because `runGeneratedDomainSuite` does not exist.

- [ ] **Step 4: Implement showcase preparation and the public-client runner**

Create `prepare-showcase.ts` with `node:child_process` `execFile` via
`promisify`:

```ts
const execFileAsync = promisify(execFile);
export async function prepareShowcase(): Promise<void> {
  await execFileAsync("pnpm", ["docs:build"], {
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
    shell: process.platform === "win32",
  });
}
```

Validate the domain suite, verify inventory, and adapt it to the existing evaluator without duplicating metric logic:

```ts
const evaluationSuite: RelevanceSuite = {
  schemaVersion: 1,
  id: suite.id,
  version: suite.version,
  language: suite.language,
  provenance: suite.provenance,
  documents: suite.pages.map((page) => ({
    id: page.id,
    title: page.title,
    body: page.title,
    url: new URL(page.id, suite.provenance.sourceUrl).href,
  })),
  queries: suite.queries.map(({ id, text, judgments }) => ({
    id,
    text,
    judgments,
  })),
};
```

Serve `showcaseDistDirectory`, create `SearchClient` with
`indexUrl: baseUrl + "search-index/manifest.json"`, `worker: false`, and
`strict: true`. Pass `mode: "lexical"`, language, and limit to `search`; map
every hit URL through `normalizePageId`. Dispose and close in `finally`.

- [ ] **Step 5: Verify and commit**

Run: `pnpm --filter showcase build && pnpm exec vitest run packages/relevance/test/domain-runner.test.ts && pnpm --filter @ktjn/searchable-relevance typecheck`

Expected: all domain-runner tests pass against the real generated index.

```powershell
git add packages/relevance/src/domain-runner.ts packages/relevance/src/prepare-showcase.ts packages/relevance/src/index.ts packages/relevance/test/domain-runner.test.ts
git commit -m "feat(relevance): evaluate generated documentation index"
```

---

### Task 4: Conditional CLI preparation and execution

**Files:**
- Modify: `packages/relevance/src/cli.ts`
- Test: `packages/relevance/test/cli.test.ts`

**Interfaces:**
- Consumes: `loadDomainSuite`, `runGeneratedDomainSuite`, and existing baseline loaders/runners.
- Produces: `CliDependencies`, `defaultCliDependencies`, and domain-aware `main(args, dependencies)`.

- [ ] **Step 1: Write failing CLI dispatch tests**

Add dependency-injected `main` tests using real value objects and function spies only at the process boundary. Assert that baseline execution never calls `prepareShowcase`, while domain execution calls it once, loads `searchable-docs`, runs the domain runner, and writes one report. Use this interface:

```ts
export interface CliDependencies {
  prepareShowcase(): Promise<void>;
  loadBaselines(language?: SupportedBaselineLanguage): Promise<RelevanceSuite[]>;
  loadDomain(name: KnownDomainSuite): Promise<DomainRelevanceSuite>;
  runBaseline(suite: RelevanceSuite, k: number): Promise<SuiteReport>;
  runDomain(suite: DomainRelevanceSuite, k: number): Promise<SuiteReport>;
  writeOutput(text: string): void;
}
```

Run: `pnpm exec vitest run packages/relevance/test/cli.test.ts`

Expected: FAIL because `main` does not accept dependencies or dispatch domains.

- [ ] **Step 2: Implement default dependency paths**

Use `prepareShowcase` from `prepare-showcase.ts`. The default domain loader resolves
`../fixtures/domains/` from built `dist/cli.js`; the runner resolves
`../../../showcase/dist` from the same module URL. Keep baseline fixture
resolution unchanged.

- [ ] **Step 3: Dispatch without changing default behavior**

In `main`, branch only when `options.suite` exists:

```ts
if (options.suite) {
  await dependencies.prepareShowcase();
  reports.push(
    await dependencies.runDomain(
      await dependencies.loadDomain(options.suite),
      options.k,
    ),
  );
} else {
  for (const suite of await dependencies.loadBaselines(options.language))
    reports.push(await dependencies.runBaseline(suite, options.k));
}
```

Use injected `writeOutput` rather than writing directly in the branch. Keep stderr/exit handling at the executable entry point.

- [ ] **Step 4: Verify default and domain commands**

Run:

```powershell
pnpm exec vitest run packages/relevance/test/cli.test.ts
pnpm relevance -- --language en --json
pnpm relevance -- --suite searchable-docs --json
```

Expected before Task 5 fixture: baseline exits 0; domain exits nonzero only with a clear missing `searchable-docs.json` error after successfully building the showcase.

- [ ] **Step 5: Commit**

```powershell
git add packages/relevance/src/cli.ts packages/relevance/test/cli.test.ts
git commit -m "feat(relevance): run documentation domain suites"
```

---

### Task 5: Curate the 28-page, 20-query draft fixture

**Files:**
- Create: `packages/relevance/fixtures/domains/searchable-docs.json`
- Create: `packages/relevance/test/domain-fixture-policy.test.ts`

**Interfaces:**
- Consumes: domain schema/loader, generated page inventory, and runner.
- Produces: the draft `searchable-docs@1.0.0` judgment set and its measured report.

- [ ] **Step 1: Write the failing committed-fixture policy test**

Assert exact invariants:

```ts
expect(suite.id).toBe("searchable-docs");
expect(suite.pages).toHaveLength(28);
expect(suite.queries).toHaveLength(20);
expect(new Set(suite.queries.map((query) => query.topic))).toEqual(
  new Set(DOMAIN_QUERY_TOPICS),
);
expect(
  suite.queries.filter(
    (query) => Object.values(query.judgments).filter((grade) => grade >= 1).length > 1,
  ).length,
).toBeGreaterThanOrEqual(5);
expect(suite.review.status).toBe("draft");
expect(await readGeneratedPageInventory(showcaseDist)).toEqual(suite.pages);
```

Run: `pnpm --filter showcase build && pnpm exec vitest run packages/relevance/test/domain-fixture-policy.test.ts`

Expected: FAIL because the fixture is missing.

- [ ] **Step 2: Add the exact generated page inventory**

Populate `pages` in lexicographic ID order from the real index: all 5 ADR
pages, 3 concept pages, 3 getting-started pages, 8 guide pages, 4 project
pages, 4 reference pages, and `/index.html` last. Use canonical forward-slash
IDs ending in `.html` and the titles from `showcase/docs-nav.ts` plus
`Searchable` for the home page.

- [ ] **Step 3: Add these exact 20 draft query intents and judgments**

Use the table as the fixture contract. Every listed positive page gets the
shown grade and a sentence explaining the page-specific value:

| Query ID | Query text | Topic | Positive pages |
|---|---|---|---|
| `install-packages` | `install packages build project` | setup | installation 3, overview 1 |
| `first-search-box` | `create first search box` | setup | first-search 3, client-api 2, indexing 1 |
| `index-rendered-html` | `index rendered html pages` | indexing-deployment | indexing 3, architecture 2 |
| `deploy-static-index` | `deploy static search index` | indexing-deployment | indexing 3, pull-based ADR 2, architecture 2 |
| `boost-important-fields` | `boost title field matches` | lexical-features | ranking-and-boosts 3, configuration 2, BM25F ADR 2 |
| `category-filters` | `category filters result counts` | lexical-features | facets 3, cms-meta-tags 2, client-api 1 |
| `sofa-couch-synonyms` | `sofa couch synonyms` | lexical-features | synonyms 3, configuration 2 |
| `pin-promoted-result` | `promoted page at top for one query` | lexical-features | pinning 3, cms-meta-tags 2 |
| `language-analyzers` | `language stemming stopwords` | internationalization | internationalization 3, configuration 2, relevance-baselines 1 |
| `offline-caching` | `offline search caching` | offline-worker | offline-search 3, client-api 2, architecture 1 |
| `web-worker-search` | `web worker search` | offline-worker | client-api 3, architecture 2, first-search 1 |
| `semantic-search` | `semantic vector search` | vector-hybrid | vector-search 3, client-api 2, opt-in ADR 1 |
| `hybrid-search` | `hybrid keyword vector search` | vector-hybrid | vector-search 3, ranking-and-boosts 2, BM25F ADR 1 |
| `index-shards` | `manifest shard files` | indexing-deployment | index-format 3, architecture 2, JSON-first ADR 2 |
| `binary-download-size` | `binary index download size` | indexing-deployment | binary-storage 3, index-format 2 |
| `client-options` | `SearchClient options result fields` | setup | client-api 3, configuration 2 |
| `cms-controls` | `CMS boosts facets pins` | lexical-features | cms-meta-tags 3, ranking-and-boosts 2, facets 2, pinning 2 |
| `format-compatibility` | `client compatibility with old index format version` | indexing-deployment | compatibility 3, compatibility ADR 2, governance 1 |
| `measure-relevance` | `MRR nDCG recall zero results` | relevance | relevance-baselines 3, roadmap 2, BM25F ADR 1 |
| `public-index-security` | `private or restricted content in generated index` | indexing-deployment | roadmap 3, architecture 2, indexing 1 |

Maintainer calibration keeps 17 queries at two to five words and three at
six to seven words as explicit strict-AND stress cases. This changes only query
wording; intents, topics, judgments, and rationales remain fixed.

Map shorthand names to canonical IDs exactly as follows:

```text
overview=/docs/getting-started/overview.html
installation=/docs/getting-started/installation.html
first-search=/docs/getting-started/first-search.html
indexing=/docs/guides/indexing.html
ranking-and-boosts=/docs/guides/ranking-and-boosts.html
facets=/docs/guides/facets.html
synonyms=/docs/guides/synonyms.html
pinning=/docs/guides/pinning.html
internationalization=/docs/guides/internationalization.html
offline-search=/docs/guides/offline-search.html
vector-search=/docs/guides/vector-search.html
architecture=/docs/concepts/architecture.html
index-format=/docs/concepts/index-format.html
binary-storage=/docs/concepts/binary-storage.html
client-api=/docs/reference/client-api.html
configuration=/docs/reference/configuration.html
cms-meta-tags=/docs/reference/cms-meta-tags.html
compatibility=/docs/reference/compatibility.html
roadmap=/docs/project/roadmap.html
relevance-baselines=/docs/project/relevance-baselines.html
governance=/docs/project/governance.html
pull-based ADR=/docs/adr/0001-pull-based-static-http.html
JSON-first ADR=/docs/adr/0002-json-first-index-format.html
BM25F ADR=/docs/adr/0003-bm25f-ranking-model.html
compatibility ADR=/docs/adr/0004-compatibility-policy.html
opt-in ADR=/docs/adr/0005-plugin-opt-in-boundary.html
```

Do not add grades for pages not listed in the table.

- [ ] **Step 4: Validate and inspect the draft report**

Run:

```powershell
pnpm --filter showcase build
pnpm exec vitest run packages/relevance/test/domain-fixture-policy.test.ts
pnpm relevance -- --suite searchable-docs --json > searchable-docs-relevance-draft.json
```

Inspect every query whose first result is not grade 3, every zero-result query,
and the returned top 5 for all multi-relevant queries. Correct only factual
judgment/rationale mistakes; do not tune ranking or rewrite queries to target a
metric. A maintainer-approved representativeness calibration may shorten query
wording while preserving intent, topic, judgments, and rationales. Delete
`searchable-docs-relevance-draft.json` after presenting its contents to the
maintainer.

- [ ] **Step 5: Commit the reviewable draft**

```powershell
git add packages/relevance/fixtures/domains/searchable-docs.json packages/relevance/test/domain-fixture-policy.test.ts
git commit -m "test(relevance): add documentation corpus draft"
```

- [ ] **Step 6: Pause for maintainer judgment review**

Present the fixture, per-query returned IDs/metrics, and aggregate metrics.
Ask the maintainer to review query wording, every positive grade, and every
rationale. Do not change `review.status` or proceed to Task 6 until explicit
approval is received.

---

### Task 6: Record review, publish guidance, update roadmap, and archive plans

**Files:**
- Modify: `packages/relevance/fixtures/domains/searchable-docs.json`
- Modify: `packages/relevance/test/domain-fixture-policy.test.ts`
- Modify: `docs/project/relevance-baselines.md`
- Modify: `docs/project/roadmap.md`
- Move: `docs/superpowers/specs/2026-07-13-searchable-docs-relevance-corpus-design.md` to `docs/archive/specs/searchable-docs-relevance-corpus.md`
- Move: `docs/superpowers/plans/2026-07-13-searchable-docs-relevance-corpus.md` to `docs/archive/plans/searchable-docs-relevance-corpus.md`
- Test: `showcase/test/docs-site.test.ts`
- Test: `showcase/test/project-identity-policy.test.ts`

**Interfaces:**
- Consumes: maintainer approval and the final measured report.
- Produces: reviewed fixture metadata, durable operating guidance, truthful roadmap status, and archived implementation records.

- [ ] **Step 1: Make reviewed-state policy expectations fail**

Change the fixture policy assertion to:

```ts
expect(suite.review).toEqual({
  status: "reviewed",
  method: "Maintainer review of every query, grade, rationale, and measured top-five result.",
  reviewer: "ktjn",
  reviewedAt: "2026-07-13",
});
```

Run: `pnpm exec vitest run packages/relevance/test/domain-fixture-policy.test.ts`

Expected: FAIL because the approved fixture still records `draft`.

- [ ] **Step 2: Record the maintainer review**

Update only the `review` block to the exact object above, unless the maintainer
requested judgment changes. If changes were requested, apply them first and
rerun the full domain report for one final review before marking `reviewed`.

Run: `pnpm exec vitest run packages/relevance/test/domain-fixture-policy.test.ts`

Expected: PASS.

- [ ] **Step 3: Add durable documentation**

Extend `docs/project/relevance-baselines.md` with:

- `pnpm relevance -- --suite searchable-docs` and `--json` examples;
- the 28-page/20-query scope and seven topic groups;
- the grade meanings and rationale requirement;
- maintainer identity/date/method from the fixture;
- current aggregate metrics from a fresh report, labeled as a baseline rather
  than a threshold;
- maintenance steps for page-inventory drift and judgment-version bumps;
- explicit limits: one English documentation domain, no user-query logs,
  latency/memory excluded, and no cross-suite score comparison.

Add a docs-site assertion that the rendered relevance page includes the domain
command and the phrase `not a pass/fail threshold`.

- [ ] **Step 4: Update roadmap truthfully**

Change the lexical-search status row to say the six-language regression
baseline plus one reviewed documentation-domain corpus are shipped. Keep
additional representative domains, broader judged query sets, quality
thresholds, and query-planner work in remaining work. Change the first
near-term bullet from singular setup work to expanding beyond the initial
documentation domain. Do not mark the relevance quality-gate program complete.

- [ ] **Step 5: Archive the working records**

Move the approved design and this plan to the archive paths listed above. Add
an archived note to each naming the implementation branch and pointing to
`docs/project/relevance-baselines.md`. Confirm:

```powershell
git ls-files docs/superpowers
```

Expected after staging the moves: no output.

- [ ] **Step 6: Run documentation review**

Apply the repository `doc-review` workflow to the relevance guide, roadmap,
archive links, commands, and tracked-plan policy. Fix every structural,
cross-reference, coverage, and quality-gate finding before continuing.

- [ ] **Step 7: Commit**

```powershell
git add packages/relevance/fixtures/domains/searchable-docs.json packages/relevance/test/domain-fixture-policy.test.ts docs showcase/test
git commit -m "docs: publish documentation relevance baseline"
```

---

### Task 7: Full verification and branch handoff

**Files:**
- Verify only; modify earlier task files solely to fix observed failures.

**Interfaces:**
- Consumes: all prior task deliverables.
- Produces: a clean, publication-ready feature branch with reproducible evidence.

- [ ] **Step 1: Run focused relevance gates**

```powershell
pnpm --filter showcase build
pnpm --filter @ktjn/searchable-relevance test
pnpm relevance -- --language en --json
pnpm relevance -- --suite searchable-docs --json
```

Expected: all commands exit 0; baseline mode remains unchanged; domain output
contains 28 documents, 20 queries, and deterministic metrics.

- [ ] **Step 2: Run the full repository matrix**

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm build
pnpm typecheck
pnpm test
pnpm size
pnpm docs:check
git diff --check
```

Expected: every command exits 0 with no warnings introduced by this branch.

- [ ] **Step 3: Verify repository truth**

```powershell
git status --short
git ls-files docs/superpowers
git log --oneline --decorate -10
```

Expected: clean status, no tracked `docs/superpowers` paths, and small
reviewable commits corresponding to Tasks 1–6.

- [ ] **Step 4: Request code review and publish**

Use `superpowers:requesting-code-review`, address any findings, rerun affected
gates, then use the GitHub publishing workflow to push the branch and open a
draft PR. Include the aggregate metrics and the explicit no-threshold/no-ranking-change boundary in the PR body.
