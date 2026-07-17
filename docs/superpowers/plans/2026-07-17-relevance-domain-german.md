# German Domain Relevance Corpus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third judged domain relevance corpus to `packages/relevance` — a German-language (`de`) snapshot corpus over a real public-sector site — following the exact conventions of the existing `govuk-learn-to-drive` suite, so it plugs into the existing `pnpm relevance -- --suite <name>` runner with no new CLI surface.

**Architecture:** Same `"snapshot"`-kind `DomainRelevanceSuite` shape as `govuk-learn-to-drive.json`, hand-authored (no automated fetch pipeline — the existing `govuk-refresh.ts` pipeline is hardcoded to the GOV.UK Content API and cannot be reused for a different source). The new suite is registered by adding its name to the hardcoded `KNOWN_DOMAIN_SUITES` tuple and adding a German-domain topic list to `DOMAIN_QUERY_TOPICS`, both in `packages/relevance/src`.

**Tech Stack:** TypeScript, Vitest, the existing `packages/relevance` fixture/validator/runner/CLI code — no new dependencies.

## Global Constraints

- Reuse the existing `DomainRelevanceSuite` schema (`schemaVersion: 2`, `kind: "snapshot"`) exactly — no schema changes in this plan (facet support is out of scope; see the design spec's Domain B split).
- Every positively-judged document (`judgments[id] >= 1`) must have a matching entry in `rationales`, and vice versa — enforced by `validate-domain-suite.ts`.
- `document.url` must equal `https://<source-host>${document.id}` exactly, and `document.contentHash` must equal `hashSnapshotContent(document)` from `packages/relevance/src/govuk-normalize.ts`.
- `provenance.retrievedAt` and `review.reviewedAt` must be real ISO `YYYY-MM-DD` dates; `review.status` starts `"draft"` and only becomes `"reviewed"` once a named maintainer has reviewed every document, query, grade, rationale, and measured top-five result (Task 8).
- No suite content changes may hit the network at evaluation time — all fetching happens once, by hand, during Task 3.
- Run `npx biome check <changed files>` and `npx vitest run <affected test files>` before any push, per `CLAUDE.md`.

---

### Task 1: Select and vet the German source

**Files:**
- Create: `docs/superpowers/notes/2026-07-17-german-domain-source-selection.md`

**Interfaces:**
- Produces: a written decision naming the exact source site, its base URL, its license and license URL, and the list of page paths to include — consumed by Tasks 3-5.

Candidates found during spec research (verify before committing to one, do not assume these facts are still accurate — re-check the live license page):

1. **Kraftfahrt-Bundesamt (KBA)**, the German federal motor transport authority (`www.kba.de`) — its site states content is under `Datenlizenz Deutschland – Namensnennung – Version 2.0` (DL-DE-BY-2.0, GOV.UK-OGL-equivalent, requires only attribution), per `https://www.kba.de/DE/Service/Hinweise/Datenlizenz/datenlizenz_deutschland_inhalt.html`. Thematically parallels the existing `govuk-learn-to-drive` suite (driving-licence domain) but in German, which gives strong cross-suite comparability once both exist. **Verify:** does the license statement apply to the narrative help/FAQ content pages themselves (not just open datasets), and is there an actual ~20-30-page narrative section (not just download tables)?
2. **GovData** (`www.govdata.de`) itself, the federal open-data portal — its own site content and documentation pages are under the same DL-DE-BY-2.0 license family. Fallback if KBA's narrative content is too thin.
3. A state (Land) citizen-services portal (e.g. `service.bund.de` or a `*.bund.de` property) — check for an explicit open license before considering; many German public sites default to all-rights-reserved copyright with no reuse license, which disqualifies them.

- [ ] **Step 1: Re-verify the license for the leading candidate**

Fetch the candidate's live license/legal-notice page and confirm in writing: (a) the exact license name and version, (b) that it explicitly covers the narrative text content of the pages you intend to use (not only datasets/downloads), (c) the license URL, (d) required attribution wording.

- [ ] **Step 2: Confirm content depth**

Browse the candidate site and confirm it has 20-30 real narrative pages (help text, FAQ, explanatory prose — not just tables/PDFs) on a coherent topic, comparable in shape to the GOV.UK learner-driving journey. If the leading candidate falls short, move to the next candidate and repeat Step 1.

- [ ] **Step 3: Write the decision note**

Write `docs/superpowers/notes/2026-07-17-german-domain-source-selection.md` recording: chosen site, base URL, license name + version + URL, exact attribution string, retrieval date (today), the full list of page paths to include (20-30), and a one-paragraph rationale for why this source represents a good German-language relevance domain distinct from the existing English docs/GOV.UK-driving suites.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/notes/2026-07-17-german-domain-source-selection.md
git commit -m "docs: record German domain source selection for relevance corpus"
```

---

### Task 2: Register the new domain suite and topic list

**Files:**
- Modify: `packages/relevance/src/domain-schema.ts`
- Modify: `packages/relevance/src/load-domain-suite.ts`
- Test: `packages/relevance/test/load-domain-suite.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 except the chosen suite `id` string (e.g. `"kba-fuehrerschein"` — pick a short kebab-case id matching the source and topic, finalized once Task 1 is done; substitute your actual chosen id everywhere `<suite-id>` appears below).
- Produces: `KNOWN_DOMAIN_SUITES` includes `<suite-id>`; `DOMAIN_QUERY_TOPICS` includes a new topic list for this suite — consumed by Tasks 4-6.

- [ ] **Step 1: Write the failing test**

Add to `packages/relevance/test/load-domain-suite.test.ts`, inside the existing `"loads both committed allowlisted domain suites"` test, changing the `toEqual` assertion:

```ts
it("loads all committed allowlisted domain suites", async () => {
  const fixtureDirectory = fileURLToPath(
    new URL("../fixtures/domains/", import.meta.url),
  );
  expect(KNOWN_DOMAIN_SUITES).toEqual([
    "searchable-docs",
    "govuk-learn-to-drive",
    "<suite-id>",
  ]);
  await expect(
    loadDomainSuite(fixtureDirectory, "govuk-learn-to-drive"),
  ).resolves.toMatchObject({ id: "govuk-learn-to-drive", version: "1.0.0" });
  await expect(
    loadDomainSuite(fixtureDirectory, "<suite-id>"),
  ).resolves.toMatchObject({ id: "<suite-id>", version: "1.0.0" });
});
```

(Rename the `it(...)` title from `"loads both committed allowlisted domain suites"` to `"loads all committed allowlisted domain suites"`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ktjn/searchable-relevance test -- load-domain-suite`
Expected: FAIL — `KNOWN_DOMAIN_SUITES` doesn't include `<suite-id>` yet, and `<suite-id>.json` doesn't exist yet.

- [ ] **Step 3: Add the suite id and topic list**

In `packages/relevance/src/domain-schema.ts`, add a new topic constant after `GOVUK_DOMAIN_QUERY_TOPICS` and include it in `DOMAIN_QUERY_TOPICS`. Choose topics that reflect the actual page inventory from Task 1 (this is a placeholder shape only — replace the example topic strings with ones matching your chosen source's real subject areas):

```ts
export const <SUITE_CONST>_DOMAIN_QUERY_TOPICS = [
  "topic-one",
  "topic-two",
  "topic-three",
] as const;

export const DOMAIN_QUERY_TOPICS = [
  ...EXISTING_DOMAIN_QUERY_TOPICS,
  ...GOVUK_DOMAIN_QUERY_TOPICS,
  ...<SUITE_CONST>_DOMAIN_QUERY_TOPICS,
] as const;
```

In `packages/relevance/src/load-domain-suite.ts`:

```ts
export const KNOWN_DOMAIN_SUITES = [
  "searchable-docs",
  "govuk-learn-to-drive",
  "<suite-id>",
] as const;
```

- [ ] **Step 4: Run test to verify it still fails on the missing fixture, not on the registration**

Run: `pnpm --filter @ktjn/searchable-relevance test -- load-domain-suite`
Expected: FAIL — now failing because `fixtures/domains/<suite-id>.json` does not exist (ENOENT), confirming the registration change is correct and only the fixture is missing.

- [ ] **Step 5: Commit**

```bash
git add packages/relevance/src/domain-schema.ts packages/relevance/src/load-domain-suite.ts packages/relevance/test/load-domain-suite.test.ts
git commit -m "feat(relevance): register new German domain suite id and topics"
```

---

### Task 3: Normalize and write the snapshot corpus

**Files:**
- Create: `packages/relevance/fixtures/domains/<suite-id>.json` (corpus section only — queries added in Task 4)
- Create: `packages/relevance/scripts/hash-german-domain-content.mjs` (throwaway helper, see Step 1)

**Interfaces:**
- Consumes: `hashSnapshotContent` from `packages/relevance/src/govuk-normalize.js` (exported, generic — takes `{ title, description, body }`, returns SHA-256 hex).
- Consumes: page list and base URL from Task 1's decision note.
- Produces: `fixtures/domains/<suite-id>.json` with `corpus.kind: "snapshot"`, `corpus.documents` populated, `review.status: "draft"` — consumed by Tasks 4-6.

There is no reusable fetch/normalize pipeline for a non-GOV.UK source (`govuk-refresh.ts` is hardcoded to the GOV.UK Content API's schema and URL shape — see the design spec). Build the corpus by hand, the same way `searchable-docs.json` was built.

- [ ] **Step 1: Write a small one-off hashing helper**

Create `packages/relevance/scripts/hash-german-domain-content.mjs`:

```js
import { createHash } from "node:crypto";

function hashSnapshotContent({ title, description, body }) {
  return createHash("sha256")
    .update(`${title}\n${description}\n${body}`, "utf8")
    .digest("hex");
}

const [, , titleArg, descriptionArg, bodyFileArg] = process.argv;
if (!titleArg || !descriptionArg || !bodyFileArg) {
  console.error(
    "usage: node hash-german-domain-content.mjs <title> <description> <bodyFile>",
  );
  process.exit(1);
}

const { readFileSync } = await import("node:fs");
const body = readFileSync(bodyFileArg, "utf8");
console.log(hashSnapshotContent({ title: titleArg, description: descriptionArg, body }));
```

This mirrors `hashSnapshotContent` exactly so hashes are consistent with what `validate-domain-suite.ts` will recompute-check via the test in Task 5. (Keep this script — it is reused for future manual snapshot corpora, not deleted after this task.)

- [ ] **Step 2: For each page from Task 1, extract and normalize text**

For each of the 20-30 pages recorded in Task 1's decision note: fetch the live page, extract the title, a one-sentence description, and the main narrative body text as plain text (strip navigation, footers, scripts — keep paragraph breaks). Save each body to a temp `.txt` file and run:

```bash
node packages/relevance/scripts/hash-german-domain-content.mjs "<title>" "<description>" /tmp/page-body.txt
```

Record the printed hash alongside the page.

- [ ] **Step 3: Write the fixture file**

Create `packages/relevance/fixtures/domains/<suite-id>.json`:

```json
{
  "schemaVersion": 2,
  "id": "<suite-id>",
  "version": "1.0.0",
  "language": "de",
  "provenance": {
    "publisher": "<from Task 1 decision note>",
    "sourceTitle": "<from Task 1 decision note>",
    "sourceUrl": "<from Task 1 decision note>",
    "license": "<from Task 1 decision note>",
    "licenseUrl": "<from Task 1 decision note>",
    "retrievedAt": "2026-07-17",
    "attribution": "<from Task 1 decision note>",
    "selectionNotes": "<from Task 1 decision note>"
  },
  "review": { "status": "draft", "method": "Maintainer review of every normalized document, query, grade, rationale, and measured top-five result." },
  "corpus": {
    "kind": "snapshot",
    "documents": [
      {
        "id": "/example-path",
        "url": "https://<source-host>/example-path",
        "title": "<page title>",
        "description": "<one-sentence description>",
        "body": "<normalized plain-text body>",
        "contentHash": "<hash from Step 2>"
      }
    ]
  },
  "queries": []
}
```

Repeat the `documents` entry for all pages from Task 1. Leave `queries: []` — filled in Task 4.

- [ ] **Step 4: Commit**

```bash
git add packages/relevance/fixtures/domains/<suite-id>.json packages/relevance/scripts/hash-german-domain-content.mjs
git commit -m "feat(relevance): add normalized German domain corpus documents (draft)"
```

---

### Task 4: Author queries and judgments

**Files:**
- Modify: `packages/relevance/fixtures/domains/<suite-id>.json`

**Interfaces:**
- Consumes: `corpus.documents` from Task 3, `<SUITE_CONST>_DOMAIN_QUERY_TOPICS` from Task 2.
- Produces: `suite.queries` populated — consumed by Tasks 5-8.

- [ ] **Step 1: Author 15-20 native-German, task-oriented queries**

Following the existing suites' methodology (`docs/project/relevance-baselines.md`): mostly concise two-to-five-word queries, a few longer natural-language queries, spread across the topics defined in Task 2. Each query object:

```json
{
  "id": "kebab-case-query-id",
  "text": "natives deutsches Suchwort",
  "topic": "<one of the Task 2 topics>",
  "judgments": { "/path-a": 3, "/path-b": 1 },
  "rationales": {
    "/path-a": "Direct-answer rationale specific to this page.",
    "/path-b": "Supporting-context rationale specific to this page."
  }
}
```

Grade every judgment `3` (direct answer), `2` (material help), or `1` (supporting context); omit documents that aren't relevant. Every judgment with grade `>= 1` needs a `rationales` entry with the exact same key, and vice versa — no extra or missing keys.

- [ ] **Step 2: Add the authored queries to the fixture**

Replace `"queries": []` in `packages/relevance/fixtures/domains/<suite-id>.json` with the authored array from Step 1.

- [ ] **Step 3: Commit**

```bash
git add packages/relevance/fixtures/domains/<suite-id>.json
git commit -m "feat(relevance): author German domain queries and judgments (draft)"
```

---

### Task 5: Lock the fixture shape with a policy test

**Files:**
- Create: `packages/relevance/test/<suite-id>-fixture-policy.test.ts`

**Interfaces:**
- Consumes: `loadDomainSuite` from `../src/load-domain-suite.js`, `hashSnapshotContent` from `../src/govuk-normalize.js`, `<SUITE_CONST>_DOMAIN_QUERY_TOPICS` from `../src/domain-schema.js`.

This mirrors `packages/relevance/test/govuk-fixture-policy.test.ts` exactly, adapted to this suite.

- [ ] **Step 1: Write the failing test**

```ts
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { <SUITE_CONST>_DOMAIN_QUERY_TOPICS } from "../src/domain-schema.js";
import { hashSnapshotContent } from "../src/govuk-normalize.js";
import { loadDomainSuite } from "../src/load-domain-suite.js";

const domainFixtureDirectory = fileURLToPath(
  new URL("../fixtures/domains/", import.meta.url),
);

describe("committed German domain relevance fixture", () => {
  it("is a well-formed draft with full judgment coverage", async () => {
    const suite = await loadDomainSuite(
      domainFixtureDirectory,
      "<suite-id>" as never,
    );
    expect(suite.id).toBe("<suite-id>");
    expect(suite.language).toBe("de");
    expect(suite.corpus.kind).toBe("snapshot");
    if (suite.corpus.kind !== "snapshot") throw new Error("unreachable");
    expect(suite.corpus.documents.length).toBeGreaterThanOrEqual(20);
    expect(suite.queries.length).toBeGreaterThanOrEqual(15);

    expect(new Set(suite.queries.map((query) => query.topic))).toEqual(
      new Set(<SUITE_CONST>_DOMAIN_QUERY_TOPICS),
    );

    for (const document of suite.corpus.documents) {
      expect(document.body.trim()).not.toBe("");
      expect(document.contentHash).toBe(hashSnapshotContent(document));
    }

    for (const query of suite.queries) {
      const positiveIds = Object.entries(query.judgments)
        .filter(([, grade]) => grade >= 1)
        .map(([id]) => id);
      expect(positiveIds.length).toBeGreaterThan(0);
      expect(Object.keys(query.rationales).sort()).toEqual(
        [...positiveIds].sort(),
      );
    }
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @ktjn/searchable-relevance test -- <suite-id>-fixture-policy`
Expected: PASS. If it fails, the failure points at exactly which fixture invariant (content hash, judgment/rationale mismatch, missing topic) needs fixing back in Tasks 3-4 — fix there, not by weakening this test.

- [ ] **Step 3: Run the full validator test suite to confirm no schema regressions**

Run: `pnpm --filter @ktjn/searchable-relevance test`
Expected: PASS across all existing tests plus the new one.

- [ ] **Step 4: Commit**

```bash
git add packages/relevance/test/<suite-id>-fixture-policy.test.ts
git commit -m "test(relevance): lock German domain fixture shape with a policy test"
```

---

### Task 6: Run the live evaluator and inspect real results

**Files:**
- None modified — verification only.

- [ ] **Step 1: Build the workspace**

Run: `pnpm build`
Expected: succeeds with no type errors.

- [ ] **Step 2: Run the new suite through the evaluator**

Run: `pnpm relevance -- --suite <suite-id> --json`
Expected: a `SuiteReport` JSON with `documentCount` and `queryCount` matching the fixture, plus MRR/Precision@5/Recall@5/nDCG@5/zero-result-rate figures and per-query returned document ids.

- [ ] **Step 3: Manually review every query's top-five results**

For each query in the JSON report, read the actual top-five returned document ids against the authored judgments. This is the same manual review step used for the existing two suites — it is not automatable, and its output feeds Task 8's `review` status flip and the baseline table written to `docs/project/relevance-baselines.md`. Note any queries that look wrong (e.g. zero results, wrong top hit) — fix the query text, judgments, or document normalization in Tasks 3-4 if something looks broken, then re-run this task.

---

### Task 7: Lint and full test pass

**Files:**
- None modified — verification only.

- [ ] **Step 1: Run biome on changed files**

Run: `npx biome check packages/relevance`
Expected: no errors on real content (ignore any pure CRLF/whitespace diffs per `CLAUDE.md` — run `git diff` after `--write` to confirm only real changes are staged if biome reports errors).

- [ ] **Step 2: Run the full relevance test suite**

Run: `pnpm --filter @ktjn/searchable-relevance test`
Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @ktjn/searchable-relevance typecheck`
Expected: no errors.

---

### Task 8: Maintainer review and baseline documentation

**Files:**
- Modify: `packages/relevance/fixtures/domains/<suite-id>.json`
- Modify: `docs/project/relevance-baselines.md`
- Modify: `docs/project/roadmap.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: the reviewed metrics from Task 6, Step 3.

- [ ] **Step 1: Flip the fixture to reviewed**

In `packages/relevance/fixtures/domains/<suite-id>.json`, change:

```json
"review": {
  "status": "reviewed",
  "method": "Maintainer review of every normalized document, query, grade, rationale, and measured top-five result.",
  "reviewer": "ktjn",
  "reviewedAt": "2026-07-17"
}
```

- [ ] **Step 2: Re-run the fixture policy test and full evaluator**

Run: `pnpm --filter @ktjn/searchable-relevance test -- <suite-id>-fixture-policy` then `pnpm relevance -- --suite <suite-id> --json`
Expected: both pass; capture the final `k = 5` metrics table (MRR, Precision@5, Recall@5, nDCG@5, zero-result rate).

- [ ] **Step 3: Add a new section to `docs/project/relevance-baselines.md`**

Add a `## Reviewed German domain corpus` section immediately after the existing `## Reviewed GOV.UK learner-driving corpus` section, following that section's exact structure: corpus id/version, page/query counts and topic breakdown, judgment/rationale policy sentence, reviewer + review date, and the metrics table from Step 2. Also add a row for this suite's `pnpm relevance -- --suite <suite-id>` command next to the existing `--suite` examples earlier in the file, and update the "Interpretation and limits" section's sentence about "one English documentation site and one UK learner-driving journey" to reflect three domains across two languages.

- [ ] **Step 4: Update `docs/project/roadmap.md`**

In the Status table's "Lexical search" row, update "reviewed documentation and GOV.UK learner-driving domain corpora" to include the new German domain. In "Near-term work," update the relevance-coverage bullet to reflect that a non-English domain has been added (leave the "real query evidence" and further-domain work open, per the design spec's Phase 2 scope).

- [ ] **Step 5: Update `CHANGELOG.md`**

Under `## [Unreleased]` → `### Added`, add a line noting the new reviewed German-language domain relevance corpus, matching the existing bullet style.

- [ ] **Step 6: Final verification**

Run: `npx biome check docs/project/relevance-baselines.md docs/project/roadmap.md CHANGELOG.md packages/relevance` and `pnpm --filter @ktjn/searchable-relevance test`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add packages/relevance/fixtures/domains/<suite-id>.json docs/project/relevance-baselines.md docs/project/roadmap.md CHANGELOG.md
git commit -m "docs(relevance): publish reviewed German domain relevance baseline"
```

---

## Self-Review Notes

- **Spec coverage:** Implements the design spec's Phase 1 "Domain A" in full (source selection, fixture format, evaluator integration, review/versioning). Phase 1 "Domain B" and Phase 2 (real query evidence) are explicitly out of scope for this plan — see the design spec's "Implementation split" section.
- **Placeholders:** `<suite-id>`, `<SUITE_CONST>`, and example page paths/topics are intentionally parametric because Task 1 (source selection) must complete before a concrete id/topic list/page inventory exists — this is a content-research dependency, not a deferred engineering decision. Every other step has complete, runnable code.
- **Type consistency:** `KNOWN_DOMAIN_SUITES`, `DOMAIN_QUERY_TOPICS`, and `loadDomainSuite` signatures are used identically across Tasks 2, 5, and 6, matching the current source exactly as read from the repository.
