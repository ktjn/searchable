# GOV.UK Learner-Driving Relevance Corpus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reviewed, deterministic 22-document GOV.UK learner-driving relevance corpus with 20 judged task queries and a safe manual Content API refresh workflow.

**Architecture:** Domain suites migrate to a schema-version-2 discriminated corpus model: the existing Searchable documentation suite keeps its generated-index path, while the GOV.UK suite stores normalized snapshot documents and evaluates them through the existing temporary-index runner. A separate networked refresh command derives the fixed journey inventory, normalizes allowlisted Content API schemas, reports drift, and writes atomically only after an explicit version and source-credit audit attestation.

**Tech Stack:** TypeScript 7, Node.js 24 built-in `fetch` and `crypto`, pnpm 11, Vitest 4, existing `@ktjn/searchable-indexer` and `@ktjn/searchable-client`, JSON fixtures, Biome.

## Global Constraints

- Include exactly 22 documents: the approved journey hub and 21 internal destinations; exclude the external theory-test application and neighboring pages.
- Commit normalized title, description, body, URL, route ID, and lowercase SHA-256 content hash for every snapshot document.
- Keep ordinary tests and `pnpm relevance` deterministic and network-free; only `relevance:refresh` may access GOV.UK.
- Use exactly 20 queries: 16 two-to-five-word searches and four longer natural questions across all seven approved topics.
- Require grades `3`, `2`, `1`, or `0`/omission and one page-specific rationale for every positive grade.
- Preserve the existing `searchable-docs@1.0.0` inventory, judgments, metrics, and command behavior while migrating its internal fixture schema to version 2.
- Keep the six native-language suites and default relevance command unchanged.
- Add no third-party dependencies, ranking changes, thresholds, CI score gates, release changes, or showcase UI.
- A refresh write requires both `--version` and `--source-credit-audit`, resets review status to `draft`, and never changes queries or judgments.
- Do not mark the GOV.UK suite reviewed until the maintainer has inspected normalized documents, every query/grade/rationale, all returned top-five lists, and aggregate metrics.
- Follow red-green-refactor for every production behavior and commit after each task.
- Before publication, archive this plan and its design under `docs/archive/`; leave no tracked path under `docs/superpowers/`.

---

### Task 1: Migrate domain fixtures to the discriminated schema

**Files:**
- Modify: `packages/relevance/src/domain-schema.ts`
- Modify: `packages/relevance/src/validate-domain-suite.ts`
- Modify: `packages/relevance/src/domain-runner.ts`
- Modify: `packages/relevance/fixtures/domains/searchable-docs.json`
- Modify: `packages/relevance/test/validate-domain-suite.test.ts`
- Modify: `packages/relevance/test/domain-runner.test.ts`
- Modify: `packages/relevance/test/domain-fixture-policy.test.ts`
- Modify: `packages/relevance/src/index.ts`

**Interfaces:**
- Consumes: existing domain review/query types and generated documentation runner.
- Produces: `GeneratedIndexDomainCorpus`, `SnapshotDomainDocument`, `SnapshotDomainCorpus`, `DomainCorpus`, and schema-version-2 `DomainRelevanceSuite`.

- [ ] **Step 1: Write failing schema-version-2 validator tests**

Replace the valid test value with this shape:

```ts
const validDomainSuite = {
  schemaVersion: 2,
  id: "searchable-docs",
  version: "1.0.0",
  language: "en",
  provenance,
  review: {
    status: "draft",
    method: "Maintainer review of every query, grade, rationale, and result.",
  },
  corpus: {
    kind: "generated-index",
    pages: [
      { id: "/index.html", title: "Searchable" },
      { id: "/docs/guides/offline-search.html", title: "Offline search" },
    ],
  },
  queries: [validQuery],
};
```

Add a valid snapshot variant:

```ts
const snapshotSuite = structuredClone(validDomainSuite);
snapshotSuite.id = "snapshot";
snapshotSuite.corpus = {
  kind: "snapshot",
  documents: [{
    id: "/learn",
    url: "https://www.gov.uk/learn",
    title: "Learn",
    description: "How to learn.",
    body: "The complete guidance.",
    contentHash: "a".repeat(64),
  }],
};
snapshotSuite.queries[0].judgments = { "/learn": 3 };
snapshotSuite.queries[0].rationales = { "/learn": "Directly answers the task." };
expect(validateDomainSuite(snapshotSuite).corpus.kind).toBe("snapshot");
```

Assert separate failures for schema version 1, unknown `corpus.kind`, a generated corpus carrying `documents`, a snapshot carrying `pages`, empty documents, duplicate document IDs, non-HTTPS URLs, URL pathname/ID mismatch, blank title/description/body, malformed hashes, and judgments targeting an ID outside the active corpus.

- [ ] **Step 2: Run the validator tests and observe the expected failure**

Run:

```powershell
pnpm exec vitest run packages/relevance/test/validate-domain-suite.test.ts
```

Expected: FAIL because schema version 2 and `corpus` are not accepted.

- [ ] **Step 3: Define the schema-version-2 types**

Replace the page field on `DomainRelevanceSuite` with:

```ts
export interface GeneratedIndexDomainCorpus {
  kind: "generated-index";
  pages: DomainPage[];
}

export interface SnapshotDomainDocument {
  id: string;
  url: string;
  title: string;
  description: string;
  body: string;
  contentHash: string;
}

export interface SnapshotDomainCorpus {
  kind: "snapshot";
  documents: SnapshotDomainDocument[];
}

export type DomainCorpus =
  | GeneratedIndexDomainCorpus
  | SnapshotDomainCorpus;

export interface DomainRelevanceSuite {
  schemaVersion: 2;
  id: string;
  version: string;
  language: SupportedBaselineLanguage;
  provenance: SuiteProvenance;
  review: JudgmentReview;
  corpus: DomainCorpus;
  queries: DomainJudgedQuery[];
}
```

Export the new types from `src/index.ts`.

- [ ] **Step 4: Validate the active corpus and exact snapshot fields**

In `validate-domain-suite.ts`, replace page extraction with a discriminated branch. Reject forbidden sibling keys using own-property checks. For snapshot documents require:

```ts
const HASH = /^[a-f0-9]{64}$/;
const parsed = new URL(url);
if (parsed.protocol !== "https:") errors.push(`${path}.url must be HTTPS`);
if (parsed.pathname !== id)
  errors.push(`${path}.url pathname must equal document id ${id}`);
if (!HASH.test(contentHash))
  errors.push(`${path}.contentHash must be a lowercase SHA-256 digest`);
```

Build one `corpusIds` set from generated pages or snapshot documents and reuse it for judgment-reference validation. Preserve every existing review, topic, grade, rationale, provenance, duplicate-query, and positive-judgment check.

- [ ] **Step 5: Migrate `searchable-docs` and its generated runner access**

Change the fixture top level from:

```json
"schemaVersion": 1,
"pages": []
```

to:

```json
"schemaVersion": 2,
"corpus": {
  "kind": "generated-index",
  "pages": []
}
```

Move the existing 28 page objects without editing them. Update the fixture policy and generated runner to read `suite.corpus.pages` after asserting `kind === "generated-index"`. Add a domain-runner test that a snapshot suite produces `Generated documentation runner requires corpus kind generated-index` rather than silently reading the wrong shape.

- [ ] **Step 6: Verify migration compatibility**

Run:

```powershell
pnpm exec vitest run packages/relevance/test/validate-domain-suite.test.ts packages/relevance/test/domain-runner.test.ts packages/relevance/test/domain-fixture-policy.test.ts
pnpm --filter @ktjn/searchable-relevance typecheck
pnpm relevance -- --suite searchable-docs
```

Expected: all focused tests and typecheck pass; the Searchable suite still reports 28 documents, 20 queries, MRR `0.650000`, nDCG@5 `0.468992`, and zero-result rate `0.200000`.

- [ ] **Step 7: Commit**

```powershell
git add packages/relevance
git commit -m "refactor(relevance): discriminate domain corpus sources"
```

---

### Task 2: Evaluate snapshot domains without building the showcase

**Files:**
- Modify: `packages/relevance/src/domain-runner.ts`
- Modify: `packages/relevance/src/cli.ts`
- Modify: `packages/relevance/test/domain-runner.test.ts`
- Modify: `packages/relevance/test/cli.test.ts`
- Modify: `packages/relevance/src/index.ts`

**Interfaces:**
- Consumes: schema-version-2 `DomainRelevanceSuite`, `runGeneratedDomainSuite`, and `runSearchableSuite`.
- Produces: `CliDependencies.prepareDomain(suite): Promise<void>` and `runDomainSuite(suite, showcaseDistDirectory, k): Promise<SuiteReport>`.

- [ ] **Step 1: Write the failing snapshot-runner test**

Build a snapshot suite with two documents and one query:

```ts
const suite = snapshotSuite([
  {
    id: "/eyesight",
    url: "https://www.gov.uk/eyesight",
    title: "Driving eyesight rules",
    description: "Eyesight rules for drivers.",
    body: "Read a number plate from 20 metres.",
    contentHash: "a".repeat(64),
  },
  {
    id: "/licence",
    url: "https://www.gov.uk/licence",
    title: "Provisional licence",
    description: "Apply for a provisional licence.",
    body: "Apply online before taking lessons.",
    contentHash: "b".repeat(64),
  },
], {
  id: "number-plate",
  text: "number plate eyesight",
  topic: "eligibility-eyesight",
  judgments: { "/eyesight": 3 },
  rationales: { "/eyesight": "States the number-plate eyesight requirement." },
});

const report = await runDomainSuite(suite, "unused", 5);
expect(report.queries[0].returnedIds[0]).toBe("/eyesight");
```

Add `eligibility-eyesight` and the other six GOV.UK topic values in Task 5, not here; for this test temporarily use an existing allowed topic such as `setup` so Task 2 remains independently green.

- [ ] **Step 2: Run the test and observe the expected failure**

Run: `pnpm exec vitest run packages/relevance/test/domain-runner.test.ts`

Expected: FAIL because `runDomainSuite` does not exist.

- [ ] **Step 3: Implement generic dispatch**

Add:

```ts
function toSnapshotEvaluationSuite(suite: DomainRelevanceSuite): RelevanceSuite {
  if (suite.corpus.kind !== "snapshot")
    throw new Error("Snapshot runner requires corpus kind snapshot");
  return {
    schemaVersion: 1,
    id: suite.id,
    version: suite.version,
    language: suite.language,
    provenance: suite.provenance,
    documents: suite.corpus.documents.map((document) => ({
      id: document.id,
      url: document.url,
      title: document.title,
      body: `${document.description}\n${document.body}`,
    })),
    queries: suite.queries.map(({ id, text, judgments }) => ({
      id,
      text,
      judgments,
    })),
  };
}

export async function runDomainSuite(
  suite: DomainRelevanceSuite,
  showcaseDistDirectory: string,
  k = 5,
): Promise<SuiteReport> {
  validateDomainSuite(suite);
  return suite.corpus.kind === "generated-index"
    ? runGeneratedDomainSuite(suite, showcaseDistDirectory, k)
    : runSearchableSuite(toSnapshotEvaluationSuite(suite), k);
}
```

Keep generated inventory validation and URL normalization unchanged.

- [ ] **Step 4: Write failing CLI preparation-order tests**

Change `CliDependencies` to the wished-for interface:

```ts
prepareDomain(suite: DomainRelevanceSuite): Promise<void>;
```

Add tests asserting:

```ts
await main(["--suite", "searchable-docs"], generatedDependencies);
expect(generatedDependencies.loadDomain).toHaveBeenCalledBefore(
  generatedDependencies.prepareDomain,
);
expect(generatedDependencies.prepareDomain).toHaveBeenCalledOnce();

await main(["--suite", "govuk-learn-to-drive"], snapshotDependencies);
expect(snapshotDependencies.prepareDomain).toHaveBeenCalledWith(snapshotSuite);
expect(snapshotDependencies.runDomain).toHaveBeenCalledWith(snapshotSuite, 5);
```

The default `prepareDomain` must be tested separately: generated calls
`prepareShowcase`, snapshot resolves without calling it, and baseline mode never
calls domain preparation.

- [ ] **Step 5: Implement conditional preparation**

Set the default dependency to:

```ts
prepareDomain: async (suite) => {
  if (suite.corpus.kind === "generated-index") await prepareShowcase();
},
runDomain: (suite, k) =>
  runDomainSuite(suite, showcaseDistDirectory, k),
```

Load once before preparation:

```ts
if (options.suite) {
  const suite = await dependencies.loadDomain(options.suite);
  await dependencies.prepareDomain(suite);
  reports.push(await dependencies.runDomain(suite, options.k));
}
```

- [ ] **Step 6: Verify and commit**

Run:

```powershell
pnpm exec vitest run packages/relevance/test/domain-runner.test.ts packages/relevance/test/cli.test.ts
pnpm --filter @ktjn/searchable-relevance typecheck
pnpm relevance -- --suite searchable-docs
```

Expected: snapshot integration passes through the real temporary index; generated behavior and metrics remain unchanged.

```powershell
git add packages/relevance/src packages/relevance/test
git commit -m "feat(relevance): evaluate snapshot domain suites"
```

---

### Task 3: Normalize the approved GOV.UK journey deterministically

**Files:**
- Create: `packages/relevance/src/govuk-normalize.ts`
- Create: `packages/relevance/test/govuk-normalize.test.ts`
- Modify: `packages/relevance/src/index.ts`

**Interfaces:**
- Consumes: unknown Content API JSON values and an approved requested route.
- Produces: `GovukContentItem`, `normalizeGovukDocument(route, item): SnapshotDomainDocument`, `htmlToText(html): string`, and `hashSnapshotContent(document): string`.

- [ ] **Step 1: Write failing shared-normalization tests**

Test exact behavior:

```ts
expect(htmlToText("<p>Eyesight &amp; rules</p><ul><li>20 metres</li></ul>"))
  .toBe("Eyesight & rules\n20 metres");
expect(htmlToText("<p>A&nbsp;B &#x2019; C &#39;</p>"))
  .toBe("A B ’ C '");
```

Assert tags, script/style blocks, comments, entities, block boundaries,
Windows whitespace, and repeated blank lines normalize deterministically. Hash
the canonical string `${title}\n${description}\n${body}` as UTF-8 and assert a
known lowercase SHA-256 value calculated in the test with `createHash`.

- [ ] **Step 2: Write one failing test per selected Content API schema**

Use minimal inline objects with the real field shapes and assert exact bodies:

| Schema | Text-bearing fields |
|---|---|
| `step_by_step_nav` | `details.step_by_step_nav.introduction`, step titles, paragraph text, and internal link text/context |
| `answer` | `details.body` |
| `transaction` | `details.introductory_paragraph` then `details.more_information` |
| `guide` | matching `details.parts[].body`; first part when route equals `base_path` |
| `publication` | `details.body` only; ignore `attachments` |
| `manual` | `details.body` and child-section titles/descriptions, never attachment bodies |
| `simple_smart_answer` | `details.body` plus user-facing strings from `details.nodes`, excluding keys named `href`, `url`, `next_node`, and `condition` |

Also assert failures for unknown schema, blank title/description/body, a guide
route with no matching part slug, a non-GOV.UK base path, and a route that does
not start with `/`.

- [ ] **Step 3: Run the tests and observe the expected failure**

Run: `pnpm exec vitest run packages/relevance/test/govuk-normalize.test.ts`

Expected: FAIL because the normalizer module does not exist.

- [ ] **Step 4: Implement HTML-to-text without a dependency**

Use a small, explicit decoder rather than a permissive HTML parser:

```ts
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"',
  ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’",
  ldquo: "“", rdquo: "”", pound: "£",
};
```

Remove comments and complete `script`/`style` blocks first. Replace closing or
self-closing block tags (`p`, `div`, headings, `li`, `br`, table rows) with a
newline, strip remaining tags, decode numeric and allowlisted named entities,
normalize `\r\n` and horizontal whitespace, trim each line, remove empty lines,
and join with `\n`. Throw on an unknown named entity so a source change cannot
silently corrupt text.

- [ ] **Step 5: Implement schema-specific extraction and hashing**

Define a narrow `record(value, path)` helper and validate top-level
`schema_name`, `base_path`, `title`, `description`, and `details`. For guides:

```ts
const suffix = route === item.base_path
  ? undefined
  : route.slice(`${item.base_path}/`.length);
const part = suffix
  ? parts.find((candidate) => candidate.slug === suffix)
  : parts[0];
```

Build `{ id: route, url: new URL(route, "https://www.gov.uk").href, title,
description, body, contentHash: "" }`, normalize every string, then fill
`contentHash` from the canonical title/description/body. For guide subroutes,
use the selected part title instead of the shared guide title.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
pnpm exec vitest run packages/relevance/test/govuk-normalize.test.ts
pnpm --filter @ktjn/searchable-relevance typecheck
```

Expected: all schema handlers and failure tests pass without a lockfile change.

```powershell
git add packages/relevance/src/govuk-normalize.ts packages/relevance/src/index.ts packages/relevance/test/govuk-normalize.test.ts
git commit -m "feat(relevance): normalize GOV.UK content snapshots"
```

---

### Task 4: Add the safe GOV.UK refresh command

**Files:**
- Create: `packages/relevance/src/govuk-refresh.ts`
- Create: `packages/relevance/src/refresh-cli.ts`
- Create: `packages/relevance/test/govuk-refresh.test.ts`
- Create: `packages/relevance/test/refresh-cli.test.ts`
- Modify: `packages/relevance/package.json`
- Modify: `package.json`
- Modify: `packages/relevance/src/index.ts`

**Interfaces:**
- Consumes: raw GOV.UK Content API values, a raw seed/current suite JSON object, and injected `fetch`/filesystem boundaries.
- Produces: `GOVUK_JOURNEY_PATH`, `GOVUK_EXPECTED_ROUTES`, `extractJourneyRoutes`, `compareSnapshot`, `refreshGovukSuite`, `RefreshOptions`, and refresh CLI parsing/main.

- [ ] **Step 1: Write failing journey-inventory tests**

Define the exact constant in the test as the 22 routes from the design, in
journey order. Feed `extractJourneyRoutes` a minimal `step_by_step_nav` tree
containing nested paragraph/list entries and the external app URL. Assert:

```ts
expect(extractJourneyRoutes(hub)).toEqual(GOVUK_EXPECTED_ROUTES.slice(1));
```

Add failures for duplicate internal routes, non-string hrefs, a different
internal route, a missing approved route, a hub schema other than
`step_by_step_nav`, and more than the one excluded external destination.

- [ ] **Step 2: Write failing refresh orchestration tests**

Use a temporary fixture file and an injected `fetch` returning a hub plus 21
minimal schema-valid items. Assert:

```ts
const checked = await refreshGovukSuite({
  mode: "check",
  fixturePath,
  fetch: fakeFetch,
});
expect(checked.changedRoutes).toEqual(["/driving-eyesight-rules"]);
expect(await readFile(fixturePath, "utf8")).toBe(original);
```

For write mode, start from a seed with empty snapshot documents and version
`0.0.0`; require `version: "1.0.0"` and `sourceCreditAudit: true`, then assert
22 documents, exact version, updated `retrievedAt`, and:

```ts
expect(updated.review).toEqual({
  status: "draft",
  method:
    "Maintainer review of every normalized document, query, grade, rationale, and measured top-five result.",
});
```

Assert that queries, topics, judgments, and rationales are byte-for-byte equal
before and after the write.

- [ ] **Step 3: Add failure and atomicity tests**

Assert no fixture change after each failure: HTTP 404/500, content type other
than JSON, redirected response URL outside `https://www.gov.uk/api/content/`,
inventory drift, malformed payload, unknown schema, content hash failure,
duplicate route, missing/malformed exact OGL provenance, missing
`sourceCreditAudit`, missing version, invalid semantic version, or a version
not greater than the committed version.

Use real temporary filesystem operations and inject `rename` to throw once;
assert the original fixture remains intact and the temporary sibling file is
removed in `finally`.

- [ ] **Step 4: Run the tests and observe the expected failure**

Run:

```powershell
pnpm exec vitest run packages/relevance/test/govuk-refresh.test.ts packages/relevance/test/refresh-cli.test.ts
```

Expected: FAIL because refresh modules and scripts do not exist.

- [ ] **Step 5: Implement route extraction and fetch validation**

Set:

```ts
export const GOVUK_JOURNEY_PATH = "/learn-to-drive-a-car";
export const GOVUK_EXPECTED_ROUTES = [
  "/learn-to-drive-a-car",
  "/vehicles-can-drive",
  "/legal-obligations-drivers-riders",
  "/driving-eyesight-rules",
  "/apply-first-provisional-driving-licence",
  "/guidance/the-highway-code",
  "/driving-lessons-learning-to-drive",
  "/find-driving-schools-and-lessons",
  "/government/publications/car-show-me-tell-me-vehicle-safety-questions",
  "/theory-test/revision-and-practice",
  "/take-practice-theory-test",
  "/book-theory-test",
  "/theory-test/what-to-take",
  "/change-theory-test",
  "/check-theory-test",
  "/cancel-theory-test",
  "/book-driving-test",
  "/driving-test/what-to-take",
  "/change-driving-test",
  "/check-driving-test",
  "/cancel-driving-test",
  "/pass-plus",
] as const;
```

Fetch `https://www.gov.uk/api/content${route}` sequentially to respect the
publisher. Require `response.ok`, JSON content type, and a final response URL
with origin `https://www.gov.uk` and pathname beginning `/api/content/`.

- [ ] **Step 6: Implement drift comparison and atomic writes**

`compareSnapshot` sorts changed routes into `added`, `removed`, and `changed`
using IDs and hashes. `check` returns the report and writes nothing. For write:

1. validate raw suite identity, snapshot kind, queries, and exact provenance;
2. fetch and normalize all 22 documents in memory;
3. replace documents, version, retrieval date, and review in a cloned value;
4. run `validateDomainSuite` on the complete candidate;
5. write `${fixturePath}.tmp-${process.pid}` with final newline;
6. rename it over the fixture;
7. remove the temporary path in `finally` if it still exists.

Implement dependency injection for `fetch`, `readFile`, `writeFile`, `rename`,
and `rm` so tests exercise the real algorithm without network access.

- [ ] **Step 7: Implement refresh CLI parsing and scripts**

Parse exactly one of `--check`/`--write`, require
`--suite govuk-learn-to-drive`, accept `--version` only for writes, and require
`--source-credit-audit` only for writes. Reject unknown options. Resolve the
fixture directory from `import.meta.url`, not `process.cwd()`.

Add package scripts:

```json
// packages/relevance/package.json
"refresh": "node dist/refresh-cli.js"

// root package.json
"relevance:refresh": "pnpm build && pnpm --filter @ktjn/searchable-relevance refresh"
```

Text output lists each changed route and ends with either `no snapshot drift`,
`snapshot drift detected`, or `snapshot updated to <version>`. In check mode,
drift sets exit code 1; no drift exits 0.

- [ ] **Step 8: Verify and commit**

Run:

```powershell
pnpm exec vitest run packages/relevance/test/govuk-normalize.test.ts packages/relevance/test/govuk-refresh.test.ts packages/relevance/test/refresh-cli.test.ts
pnpm --filter @ktjn/searchable-relevance typecheck
pnpm lint
```

Expected: all refresh tests pass, lint is clean, and `pnpm-lock.yaml` is unchanged.

```powershell
git add package.json packages/relevance
git commit -m "feat(relevance): refresh GOV.UK snapshots safely"
```

---

### Task 5: Curate and measure the draft GOV.UK corpus

**Files:**
- Create: `packages/relevance/fixtures/domains/govuk-learn-to-drive.json`
- Create: `packages/relevance/test/govuk-fixture-policy.test.ts`
- Modify: `packages/relevance/src/domain-schema.ts`
- Modify: `packages/relevance/src/load-domain-suite.ts`
- Modify: `packages/relevance/test/load-domain-suite.test.ts`
- Modify: `packages/relevance/test/cli.test.ts`
- Modify: `packages/relevance/fixtures/NOTICE.md`

**Interfaces:**
- Consumes: GOV.UK refresh command, schema-version-2 loader, and generic snapshot runner.
- Produces: the draft `govuk-learn-to-drive@1.0.0` snapshot and measured report.

- [ ] **Step 1: Add the seven exact GOV.UK topics with a failing test**

Define and export this focused tuple, then spread it into
`DOMAIN_QUERY_TOPICS` after the existing values:

```ts
export const GOVUK_DOMAIN_QUERY_TOPICS = [
"eligibility-eyesight",
"provisional-licence",
"lessons-practice",
"theory-preparation",
"theory-test-management",
"practical-test-management",
"after-passing",
] as const;

export const DOMAIN_QUERY_TOPICS = [
  ...EXISTING_DOMAIN_QUERY_TOPICS,
  ...GOVUK_DOMAIN_QUERY_TOPICS,
] as const;
```

Keep the existing values in a private `EXISTING_DOMAIN_QUERY_TOPICS` tuple so
their order and inferred union members remain unchanged. Export
`GOVUK_DOMAIN_QUERY_TOPICS` from `src/index.ts` for the fixture-policy test.

First update the validator test to expect each value to pass and an unknown
value to fail. Run the test before editing the constant and observe failure.

- [ ] **Step 2: Create the seed fixture with exact metadata and queries**

Create schema version 2, ID `govuk-learn-to-drive`, version `0.0.0`, language
`en`, snapshot corpus with empty `documents`, and draft review method:

```text
Maintainer review of every normalized document, query, grade, rationale, and measured top-five result.
```

Use this provenance exactly:

```json
{
  "publisher": "Government Digital Service and GOV.UK publishing organisations",
  "sourceTitle": "Learn to drive a car: step by step",
  "sourceUrl": "https://www.gov.uk/learn-to-drive-a-car",
  "license": "Open Government Licence v3.0",
  "licenseUrl": "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
  "retrievedAt": "2026-07-13",
  "attribution": "Contains public sector information licensed under the Open Government Licence v3.0.",
  "selectionNotes": "The journey hub and its 21 internal GOV.UK destinations are included. The external theory-test application and neighboring pages are excluded. Searchable text is normalized from the GOV.UK Content API."
}
```

Add the exact query contract below. Every positive page receives the listed
grade and rationale; do not add other positive pages before inspecting results.

| ID | Text | Topic | Positive judgments and rationales |
|---|---|---|---|
| `minimum-driving-age` | `minimum age learn drive` | eligibility-eyesight | `/vehicles-can-drive` 3 — Gives vehicle-specific minimum ages and licence eligibility; `/learn-to-drive-a-car` 2 — States the usual starting age and links to the detailed check. |
| `eyesight-number-plate` | `eyesight test number plate` | eligibility-eyesight | `/driving-eyesight-rules` 3 — States the number-plate reading and visual-acuity rules; `/learn-to-drive-a-car` 1 — Links eyesight checks from the eligibility step. |
| `legal-driving-requirements` | `what do I need before driving legally` | eligibility-eyesight | `/legal-obligations-drivers-riders` 3 — Lists licence, insurance, tax, registration, and MOT obligations; `/learn-to-drive-a-car` 2 — Orders the legal eligibility steps for a learner. |
| `first-provisional-licence` | `first provisional licence online` | provisional-licence | `/apply-first-provisional-driving-licence` 3 — Gives the first-licence online application requirements and process; `/learn-to-drive-a-car` 2 — Places the provisional licence before lessons and tests. |
| `lessons-without-provisional` | `can I take lessons without provisional licence` | provisional-licence | `/driving-lessons-learning-to-drive` 3 — Explains the licence and supervision requirements for lessons and practice; `/apply-first-provisional-driving-licence` 2 — Provides the required provisional-licence application; `/learn-to-drive-a-car` 2 — Explicitly says a provisional licence is needed for lessons or practice. |
| `approved-instructor` | `approved driving instructor near me` | lessons-practice | `/find-driving-schools-and-lessons` 3 — Provides the approved-instructor search service; `/driving-lessons-learning-to-drive` 2 — Explains who may teach a learner and how lessons work. |
| `family-practice` | `practise driving family insurance` | lessons-practice | `/driving-lessons-learning-to-drive` 3 — Covers practice with family or friends, supervision, and insurance; `/legal-obligations-drivers-riders` 1 — Provides supporting insurance and legal obligations. |
| `show-tell-questions` | `show me tell me questions` | lessons-practice | `/government/publications/car-show-me-tell-me-vehicle-safety-questions` 3 — Publishes the exact vehicle-safety questions used in the car test; `/driving-test/what-to-take` 1 — Gives supporting practical-test preparation context. |
| `highway-code` | `highway code road rules` | theory-preparation | `/guidance/the-highway-code` 3 — Is the authoritative road-user rules manual; `/theory-test/revision-and-practice` 1 — Explains using official materials to revise for the theory test. |
| `practice-theory-test` | `free practice theory test` | theory-preparation | `/take-practice-theory-test` 3 — Links the free official practice tests; `/theory-test/revision-and-practice` 2 — Explains revision and the tested question formats. |
| `hazard-perception` | `hazard perception revision` | theory-preparation | `/theory-test/revision-and-practice` 3 — Explains hazard-perception preparation and test structure; `/take-practice-theory-test` 1 — Supplies related official practice material. |
| `book-theory-test` | `book theory test cost` | theory-test-management | `/book-theory-test` 3 — Provides the official booking service and current fee; `/learn-to-drive-a-car` 1 — Shows booking within the learner journey. |
| `move-theory-test` | `move theory test earlier` | theory-test-management | `/change-theory-test` 3 — Explains finding an earlier date, moving the appointment, or changing centre. |
| `lost-theory-confirmation` | `lost theory confirmation email` | theory-test-management | `/check-theory-test` 3 — Retrieves appointment details when the confirmation email is lost or deleted. |
| `cancel-theory-refund` | `how late can I cancel theory test for refund` | theory-test-management | `/cancel-theory-test` 3 — States the cancellation notice and refund rules. |
| `book-practical-test` | `book practical driving test` | practical-test-management | `/book-driving-test` 3 — Provides the official practical-test booking service; `/learn-to-drive-a-car` 1 — Shows when practical booking becomes available. |
| `bring-to-driving-test` | `what bring driving test` | practical-test-management | `/driving-test/what-to-take` 3 — Lists the documents and items required at the practical test; `/theory-test/what-to-take` 2 — Materially helps when “driving test” refers to the theory stage rather than the practical test. |
| `manage-practical-appointment` | `manage practical test appointment` | practical-test-management | `/change-driving-test` 3 — Changes date, time, or test centre; `/check-driving-test` 2 — Retrieves existing appointment details; `/cancel-driving-test` 2 — Cancels an appointment that is no longer needed. |
| `cancel-practical-refund` | `practical test refund cancellation` | practical-test-management | `/cancel-driving-test` 3 — States practical-test cancellation and refund conditions. |
| `after-passing` | `what happens after I pass my driving test` | after-passing | `/learn-to-drive-a-car` 3 — States when a successful candidate may drive and the insurance requirement; `/pass-plus` 2 — Explains optional post-test training and possible insurance discounts; `/legal-obligations-drivers-riders` 1 — Supplies continuing legal obligations for drivers. |

- [ ] **Step 3: Write the failing fixture policy test**

Assert:

```ts
expect(suite.id).toBe("govuk-learn-to-drive");
expect(suite.version).toBe("1.0.0");
expect(suite.corpus.kind).toBe("snapshot");
expect(suite.corpus.documents).toHaveLength(22);
expect(suite.queries).toHaveLength(20);
expect(compactQueries).toHaveLength(16);
expect(longQueries).toHaveLength(4);
expect(new Set(suite.queries.map((query) => query.topic))).toEqual(
  new Set(GOVUK_DOMAIN_QUERY_TOPICS),
);
expect(suite.review.status).toBe("draft");
expect(suite.corpus.documents.map((document) => document.id)).toEqual(
  GOVUK_EXPECTED_ROUTES,
);
```

Also assert every URL is `https://www.gov.uk${id}`, all hashes match the
canonical content, every body is nonblank, all 22 IDs have at least one
positive judgment across the query set or are explicitly listed in a policy
constant as context-only, and exact OGL provenance is present.

Run the test and observe failure because documents are empty and the suite is
not allowlisted.

- [ ] **Step 4: Perform the initial source-credit audit and snapshot write**

Open every selected public URL and check page-level credits for a stated
licensing exception. Do not proceed if any selected main text is excluded from
the OGL. Record the audit in the commit notes, then run:

```powershell
pnpm relevance:refresh -- --suite govuk-learn-to-drive --write --version 1.0.0 --source-credit-audit
```

Expected: the command writes exactly 22 normalized documents, sets version
`1.0.0`, and leaves review status `draft`.

- [ ] **Step 5: Allowlist the suite and verify fixture policy**

Change:

```ts
export const KNOWN_DOMAIN_SUITES = [
  "searchable-docs",
  "govuk-learn-to-drive",
] as const;
```

Extend loader and CLI parser tests for the new known value. Run:

```powershell
pnpm exec vitest run packages/relevance/test/govuk-fixture-policy.test.ts packages/relevance/test/load-domain-suite.test.ts packages/relevance/test/cli.test.ts
```

Expected: all tests pass and both known suites load by allowlisted name.

- [ ] **Step 6: Add OGL fixture notice**

Extend `packages/relevance/fixtures/NOTICE.md` with the exact attribution from
the fixture, the OGL v3.0 link, the journey URL, the retrieval date, the
normalization changes, and the statement that attachments/media/external app
content are excluded. State that repository code remains MIT-licensed.

- [ ] **Step 7: Measure and inspect the draft**

Run:

```powershell
pnpm relevance -- --suite searchable-docs --json
pnpm relevance -- --suite govuk-learn-to-drive --json > govuk-driving-relevance-draft.json
```

Confirm Searchable metrics are unchanged. Inspect every GOV.UK query whose
first result is not grade 3, every zero-result query, and all returned top-five
lists for multi-relevant queries. Correct only factual normalization,
judgment, or rationale mistakes. Query text may receive one representativeness
calibration pass, but do not tune ranking or target an aggregate score. Delete
`govuk-driving-relevance-draft.json` after presenting its contents.

- [ ] **Step 8: Commit the reviewable draft and pause**

```powershell
git add packages/relevance
git commit -m "test(relevance): add GOV.UK driving corpus draft"
```

Present the normalized inventory, every query/grade/rationale, per-query top
five, aggregate metrics, source-credit audit, and content-hash inventory. Do
not proceed to Task 6 until the maintainer explicitly approves the draft.

---

### Task 6: Record review, publish guidance, update roadmap, and archive records

**Files:**
- Modify: `packages/relevance/fixtures/domains/govuk-learn-to-drive.json`
- Modify: `packages/relevance/test/govuk-fixture-policy.test.ts`
- Modify: `docs/project/relevance-baselines.md`
- Modify: `docs/project/roadmap.md`
- Modify: `showcase/test/docs-site.test.ts`
- Move: `docs/superpowers/specs/2026-07-13-govuk-driving-relevance-corpus-design.md` to `docs/archive/specs/govuk-driving-relevance-corpus.md`
- Move: `docs/superpowers/plans/2026-07-13-govuk-driving-relevance-corpus.md` to `docs/archive/plans/govuk-driving-relevance-corpus.md`

**Interfaces:**
- Consumes: explicit maintainer approval and the final measured report.
- Produces: reviewed metadata, durable maintenance guidance, truthful roadmap status, and archived implementation records.

- [ ] **Step 1: Make reviewed-state policy fail**

Change the fixture-policy expectation to:

```ts
expect(suite.review).toEqual({
  status: "reviewed",
  method:
    "Maintainer review of every normalized document, query, grade, rationale, and measured top-five result.",
  reviewer: "ktjn",
  reviewedAt: "2026-07-13",
});
```

Run the focused test and observe draft/reviewed failure.

- [ ] **Step 2: Record review and rerun both suites**

Update only the review block unless the maintainer requested changes. If
changes were requested, apply them first, increment the suite version if
documents/queries/judgments/rationales changed, rerun the GOV.UK JSON report,
and obtain final approval. Then run both domain suites and the fixture policy.

- [ ] **Step 3: Publish durable relevance guidance test-first**

Extend `showcase/test/docs-site.test.ts` to require the rendered relevance page
to include:

```text
pnpm relevance -- --suite govuk-learn-to-drive
pnpm relevance:refresh -- --suite govuk-learn-to-drive --check
source-credit audit
not a pass/fail threshold
```

Observe failure, then document the 22-page/20-query scope, seven topics, OGL
attribution, reviewer/date/method, final aggregate metrics, ordinary offline
evaluation, check/write refresh commands, version rule, source-credit audit,
hash drift, and limits: one UK journey, authored queries rather than logs, no
latency/memory evidence, and no cross-suite score comparison.

- [ ] **Step 4: Update roadmap truthfully**

Change lexical-search status to two reviewed representative domains. Change
the first near-term bullet to expand beyond the documentation and learner-
driving domains with broader judged sets and real query evidence. Keep quality
thresholds, performance evidence, query planning, and CI enforcement open.

- [ ] **Step 5: Archive design and plan**

Move the files to the archive paths above. Add an archive note to each naming
`feat/govuk-driving-relevance-corpus` and linking to
`docs/project/relevance-baselines.md`. Stage the moves and verify:

```powershell
git ls-files docs/superpowers
```

Expected: no output.

- [ ] **Step 6: Run doc review and commit**

Apply all four `doc-review` phases to the guide, roadmap, notice, archived
records, commands, metrics, and cross-links. No ADR change is required because
the implementation remains private evaluation tooling; record that rationale
in the PR. Fix every blocker.

```powershell
git add docs packages/relevance/fixtures showcase/test/docs-site.test.ts
git commit -m "docs: publish GOV.UK relevance baseline"
```

---

### Task 7: Full verification, review, and publication

**Files:**
- Verify only; modify earlier task files solely to fix observed failures.

**Interfaces:**
- Consumes: all prior deliverables.
- Produces: a clean, reproducible feature branch and draft pull request.

- [ ] **Step 1: Run focused domain and refresh gates**

```powershell
pnpm --filter @ktjn/searchable-relevance test
pnpm relevance -- --language en --json
pnpm relevance -- --suite searchable-docs --json
pnpm relevance -- --suite govuk-learn-to-drive --json
pnpm relevance:refresh -- --suite govuk-learn-to-drive --check
```

Expected: tests and all evaluations exit 0; Searchable metrics are unchanged;
GOV.UK reports 22 documents and 20 queries; refresh reports no snapshot drift.
If the live source changed after review, return to Task 5 rather than updating
the snapshot during final verification.

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

Expected: every command exits 0, no dependency drift, and no new warnings.

- [ ] **Step 3: Verify repository truth**

```powershell
git status --short
git ls-files docs/superpowers
git log --oneline --decorate -12
```

Expected: clean status, no tracked internal planning paths, and small commits
corresponding to Tasks 1–6.

- [ ] **Step 4: Request review and publish**

Use `superpowers:requesting-code-review`, address all critical/important
findings, and rerun affected gates. Then use `github:yeet` to push
`feat/govuk-driving-relevance-corpus` and open a draft PR against `main`.

The PR body must include both domain metrics, OGL/source-credit audit, the
schema migration compatibility result, full verification evidence, doc-review
result, and the explicit no-ranking-change/no-threshold/no-CI-gate boundary.
