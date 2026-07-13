# Multilingual Relevance Baseline Implementation Plan

> **Archived:** Completed on `feature/multilingual-relevance-baseline`. Current operating guidance and limitations are maintained in [Relevance baselines](../../project/relevance-baselines.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reproducible, native-source lexical relevance baseline for every full Searchable language profile.

**Architecture:** A private `@ktjn/searchable-relevance` workspace package owns fixture validation, pure ranking metrics, public-API evaluation, deterministic reporting, and the CLI. Six committed suites contain native FAQ/help questions and answers with provenance; the runner builds each suite through `@ktjn/searchable-indexer` and queries it through `@ktjn/searchable-client` over local HTTP.

**Tech Stack:** TypeScript 7, Node.js 24, pnpm 11, Vitest 4, existing Searchable indexer/client packages, JSON fixtures, Biome.

## Global Constraints

- Support exactly the full profiles `en`, `de`, `sv`, `nl`, `nb`, and `nn`; do not add fallback-segmenter languages.
- Fixture text must originate in authoritative native-language FAQ/help sources; do not translate or generate it.
- Every redistributed excerpt must have a source URL, license URL, attribution, retrieval date, and selection notes.
- Evaluation and tests must perform no external network access.
- Use only public exports from `@ktjn/searchable-indexer` and `@ktjn/searchable-client`.
- Default to lexical search and `k = 5`; do not change ranking behavior or add CI score thresholds.
- Reports must be deterministic and must not include timestamps or performance claims.
- Follow TDD for production code: add one failing behavior test, observe the expected failure, implement minimally, and rerun.
- Before publication, archive this plan and its design under `docs/archive/`; leave no tracked file under `docs/superpowers/`.

---

### Task 1: Package scaffold and suite validation

**Files:**
- Create: `packages/relevance/package.json`
- Create: `packages/relevance/tsconfig.json`
- Create: `packages/relevance/vitest.config.ts`
- Create: `packages/relevance/src/schema.ts`
- Create: `packages/relevance/src/validate-suite.ts`
- Create: `packages/relevance/src/index.ts`
- Test: `packages/relevance/test/validate-suite.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `SUPPORTED_BASELINE_LANGUAGES`, `RelevanceSuite`, `JudgedQuery`, `RelevanceDocument`, `SuiteProvenance`, `validateSuite(value: unknown): RelevanceSuite`.

- [ ] **Step 1: Add the private workspace package**

Create `package.json` with name `@ktjn/searchable-relevance`, `private: true`, Node `>=24`, `type: module`, build/test/typecheck/evaluate scripts, workspace dependencies on the client and indexer, and dev dependencies matching the repository's TypeScript, Vitest, and `@types/node` versions. Create a `tsconfig.json` extending `../../tsconfig.base.json` with `outDir: "dist"`, `rootDir: "src"`, `lib: ["ES2022", "DOM"]`, and Node types. Create the standard Node Vitest config used by the other packages.

Run: `pnpm install --lockfile-only`

Expected: `pnpm-lock.yaml` contains an importer for `packages/relevance`.

- [ ] **Step 2: Write validation tests first**

Cover one valid suite plus separate failures for unsupported language, blank provenance, malformed retrieval date/URL, duplicate document/query IDs, empty text, unknown judgment IDs, grades outside `0..3`, and queries without a positive judgment. Use this minimal valid value:

```ts
const validSuite = {
  schemaVersion: 1,
  id: "en-native-help-v1",
  version: "1.0.0",
  language: "en",
  provenance: {
    publisher: "Example public body",
    sourceTitle: "Help",
    sourceUrl: "https://example.test/help",
    license: "CC-BY-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    retrievedAt: "2026-07-13",
    attribution: "Example public body",
    selectionNotes: "Questions and corresponding answers were selected verbatim.",
  },
  documents: [{ id: "answer-1", title: "Answer one", body: "Native answer text.", url: "https://example.test/help#one" }],
  queries: [{ id: "question-1", text: "Native question?", judgments: { "answer-1": 3 } }],
};
```

Run: `pnpm --filter @ktjn/searchable-relevance test -- validate-suite.test.ts`

Expected: FAIL because `validateSuite` does not exist.

- [ ] **Step 3: Implement schema types and validation**

Define the literal language and grade unions from the design. Implement runtime type guards without adding a schema dependency. Accumulate path-qualified errors and throw one `Error` beginning `Invalid relevance suite:`. Treat `YYYY-MM-DD` as valid only when it round-trips through a UTC `Date`; require HTTP(S) URLs via `new URL`; require at least one document/query and one grade `>= 1` per query.

- [ ] **Step 4: Verify validation and package gates**

Run: `pnpm --filter @ktjn/searchable-relevance test -- validate-suite.test.ts && pnpm --filter @ktjn/searchable-relevance typecheck`

Expected: all validation tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/relevance pnpm-lock.yaml
git commit -m "feat(relevance): validate judged suites"
```

---

### Task 2: Ranking metrics

**Files:**
- Create: `packages/relevance/src/metrics.ts`
- Test: `packages/relevance/test/metrics.test.ts`
- Modify: `packages/relevance/src/index.ts`

**Interfaces:**
- Consumes: `RelevanceGrade`.
- Produces: `reciprocalRank`, `precisionAtK`, `recallAtK`, `ndcgAtK`, `isZeroResult`, and `evaluateRanking`.

- [ ] **Step 1: Write hand-calculated failing tests**

Use judgments `{ a: 3, b: 2, c: 1, x: 0 }` and assert:

```ts
expect(reciprocalRank(["x", "b"], judgments)).toBe(0.5);
expect(precisionAtK(["a", "x"], judgments, 3)).toBeCloseTo(1 / 3);
expect(recallAtK(["a", "x"], judgments, 2)).toBeCloseTo(1 / 3);
expect(ndcgAtK(["b", "a"], judgments, 2)).toBeCloseTo(
  (3 + 7 / Math.log2(3)) / (7 + 3 / Math.log2(3)),
);
expect(isZeroResult([])).toBe(true);
expect(() => evaluateRanking(["a", "a"], judgments, 5)).toThrow(/duplicate result id a/);
expect(() => precisionAtK([], judgments, 0)).toThrow(/positive integer/);
```

Run: `pnpm --filter @ktjn/searchable-relevance test -- metrics.test.ts`

Expected: FAIL because the metric functions do not exist.

- [ ] **Step 2: Implement the pure functions**

Use grade `>= 1` for binary relevance. Precision always divides by `k`; recall divides by all positive judgments; nDCG uses gain `2 ** grade - 1` and discount `Math.log2(rank + 1)`. `evaluateRanking` checks duplicates once and returns all five per-query values.

- [ ] **Step 3: Verify and commit**

Run: `pnpm --filter @ktjn/searchable-relevance test -- metrics.test.ts`

Expected: all metric tests pass with no warnings.

```bash
git add packages/relevance/src packages/relevance/test/metrics.test.ts
git commit -m "feat(relevance): calculate ranking metrics"
```

---

### Task 3: Suite evaluator and deterministic report model

**Files:**
- Create: `packages/relevance/src/evaluate.ts`
- Test: `packages/relevance/test/evaluate.test.ts`
- Modify: `packages/relevance/src/index.ts`

**Interfaces:**
- Consumes: `validateSuite`, `evaluateRanking`.
- Produces: `QueryReport`, `SuiteReport`, `SearchForEvaluation`, `evaluateSuite(suite, search, k)`.

- [ ] **Step 1: Write the failing evaluator test**

Use two queries and a real async callback returning `answer-1` for the first and no hits for the second. Assert stable query order, returned IDs, per-query metrics, arithmetic aggregate means, query/document counts, provenance, language, version, and `zeroResultRate === 0.5`. Also assert that a callback exception is rethrown with suite language and query ID while retaining `cause`.

Run: `pnpm --filter @ktjn/searchable-relevance test -- evaluate.test.ts`

Expected: FAIL because `evaluateSuite` does not exist.

- [ ] **Step 2: Implement evaluation**

Use this callback boundary:

```ts
export type SearchForEvaluation = (
  query: string,
  options: { language: SupportedBaselineLanguage; limit: number },
) => Promise<readonly string[]>;
```

Validate `k` as a positive integer, validate the suite before searching, sort queries by ID, evaluate sequentially for deterministic failures, and average each metric across query reports. Do not round values in the model.

- [ ] **Step 3: Verify and commit**

Run: `pnpm --filter @ktjn/searchable-relevance test -- evaluate.test.ts`

Expected: evaluator tests pass.

```bash
git add packages/relevance/src packages/relevance/test/evaluate.test.ts
git commit -m "feat(relevance): evaluate judged query suites"
```

---

### Task 4: Run suites through the public Searchable APIs

**Files:**
- Create: `packages/relevance/src/static-server.ts`
- Create: `packages/relevance/src/searchable-runner.ts`
- Test: `packages/relevance/test/searchable-runner.test.ts`
- Modify: `packages/relevance/src/index.ts`

**Interfaces:**
- Consumes: `buildIndex`, `writeIndex`, `SearchClient`, `evaluateSuite`.
- Produces: `runSearchableSuite(suite: RelevanceSuite, k?: number): Promise<SuiteReport>`.

- [ ] **Step 1: Write the failing real-boundary test**

Create a three-document English suite where query `reset password` judges the password-reset answer as grade 3 and query `invoice copy` judges the invoice answer as grade 3. Call `runSearchableSuite(suite, 3)` and assert both expected fixture IDs rank first. Do not mock HTTP, the indexer, fetch, or `SearchClient`.

Run: `pnpm --filter @ktjn/searchable-relevance test -- searchable-runner.test.ts`

Expected: FAIL because `runSearchableSuite` does not exist.

- [ ] **Step 2: Implement the local static server**

Use `node:http` on `127.0.0.1` and port `0`. Resolve decoded request paths beneath the temporary root, reject traversal with 403, return 404 for missing files, and return bytes with JSON or octet-stream content type. Return `{ baseUrl, close }`, where `close()` is promise-based.

- [ ] **Step 3: Implement the public-API runner**

Escape `& < > "` before placing titles/bodies into HTML. Assign numeric IDs by documents sorted by fixture ID and retain a numeric-to-fixture-ID map. Build `SourceDocument[]`, call `writeIndex(buildIndex(sources, suite.language), tempDir)`, start the server, create `new SearchClient({ indexUrl: baseUrl + "manifest.json", worker: false, strict: true })`, and pass a callback using `client.search(query, { language, limit })`. Always dispose the client, close the server, and recursively remove the temporary directory in `finally`.

- [ ] **Step 4: Verify cleanup and commit**

Add a second test whose query fails and assert the wrapped error context; instrument the temporary-root factory through an optional internal dependency argument so the test can assert the root no longer exists without exposing a test-only public API.

Run: `pnpm --filter @ktjn/searchable-relevance test -- searchable-runner.test.ts`

Expected: both real-boundary and cleanup tests pass.

```bash
git add packages/relevance/src packages/relevance/test/searchable-runner.test.ts
git commit -m "feat(relevance): run suites through public search APIs"
```

---

### Task 5: Fixture discovery, CLI, and reports

**Files:**
- Create: `packages/relevance/src/load-suites.ts`
- Create: `packages/relevance/src/report.ts`
- Create: `packages/relevance/src/cli.ts`
- Test: `packages/relevance/test/load-suites.test.ts`
- Test: `packages/relevance/test/report.test.ts`
- Test: `packages/relevance/test/cli.test.ts`
- Modify: `packages/relevance/package.json`
- Modify: `packages/relevance/src/index.ts`

**Interfaces:**
- Produces: `loadSuites(directory)`, `renderConsoleReport`, `serializeJsonReport`, and CLI options `--language`, `--k`, `--json`.

- [ ] **Step 1: Test discovery and deterministic rendering first**

Create temporary `en.json` and `de.json` suites in reverse directory order and assert `loadSuites` returns language order. Assert duplicate/missing language errors. For a fixed `SuiteReport`, assert console fields and an exact JSON snapshot with keys in declared order and numeric values rounded to six decimal places.

Run: `pnpm --filter @ktjn/searchable-relevance test -- load-suites.test.ts report.test.ts`

Expected: FAIL because loaders/renderers do not exist.

- [ ] **Step 2: Implement discovery and reports**

Read only `*.json`, parse and validate each file, sort by `SUPPORTED_BASELINE_LANGUAGES`, and require exactly one suite for every language unless the caller supplied a language filter. Render aggregate metrics and provenance in text; serialize a top-level `{ schemaVersion: 1, k, suites }` object with no run time or timestamp.

- [ ] **Step 3: Test and implement CLI parsing**

Test `--language sv`, `--k 10`, `--json`, unknown flags, missing values, unsupported languages, and non-positive/non-integer cutoffs. Keep parsing in an exported pure `parseCliArgs`; keep process exit/output in `main`. The default fixture directory is `new URL("../fixtures/", import.meta.url)` from built `dist/cli.js`.

Run: `pnpm --filter @ktjn/searchable-relevance test -- cli.test.ts`

Expected before implementation: FAIL because `parseCliArgs` does not exist. Expected after implementation: all CLI tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/relevance
git commit -m "feat(relevance): add deterministic evaluation CLI"
```

---

### Task 6: Curate six native-source suites

**Files:**
- Create: `packages/relevance/fixtures/en.json`
- Create: `packages/relevance/fixtures/de.json`
- Create: `packages/relevance/fixtures/sv.json`
- Create: `packages/relevance/fixtures/nl.json`
- Create: `packages/relevance/fixtures/nb.json`
- Create: `packages/relevance/fixtures/nn.json`
- Create: `packages/relevance/fixtures/NOTICE.md`
- Test: `packages/relevance/test/fixture-policy.test.ts`

**Interfaces:**
- Consumes: suite schema and loader.
- Produces: one versioned native-source baseline per full profile.

- [ ] **Step 1: Write the failing coverage policy test**

Load the real fixture directory and assert exact language coverage, filename/language agreement, unique suite IDs, at least 8 documents and 8 queries per language, positive judgments for every query, complete provenance, and source URLs distinct from license URLs.

Run: `pnpm --filter @ktjn/searchable-relevance test -- fixture-policy.test.ts`

Expected: FAIL listing all six missing suites.

- [ ] **Step 2: Complete a source-license audit before copying text**

For each language, record candidate publisher, exact FAQ/help URL, exact license URL, whether the page is native-authored or professionally localized, whether redistribution/modification is allowed, and required attribution in `NOTICE.md`. Reject automatic translations, ambiguous copyright terms, user-submitted text without a redistribution grant, and sources that cannot provide eight coherent question/answer pairs. Prefer one publisher/license family across languages, but use a separate Norwegian source when necessary for genuine Bokmål and Nynorsk.

- [ ] **Step 3: Curate and validate each suite**

Copy question wording and its corresponding answer/help text without translation. Mechanically remove page chrome and markup, retain meaning, assign stable descriptive IDs, use grade 3 for the direct answer, and add grades 1 or 2 only where another answer genuinely helps. Store the canonical source URL on each document. Run the single-language CLI after each file:

`pnpm --filter @ktjn/searchable-relevance build && pnpm --filter @ktjn/searchable-relevance evaluate -- --language <code> --json`

Expected: valid deterministic JSON; inspect every zero-result query and every first result that is not grade 3. Do not tune engine ranking in this task.

- [ ] **Step 4: Run all fixture and evaluation tests**

Run: `pnpm --filter @ktjn/searchable-relevance test && pnpm --filter @ktjn/searchable-relevance evaluate -- --json > relevance-baseline.json`

Expected: tests pass; the report contains six suites in `en,de,sv,nl,nb,nn` order. Delete the generated root report after inspection; reports are reproducible output, not committed artifacts.

- [ ] **Step 5: Commit**

```bash
git add packages/relevance/fixtures packages/relevance/test/fixture-policy.test.ts
git commit -m "test(relevance): add native multilingual baselines"
```

---

### Task 7: Durable documentation, roadmap status, verification, and archive

**Files:**
- Create: `docs/project/relevance-baselines.md`
- Modify: `docs/project/roadmap.md`
- Modify: `showcase/docs-nav.ts`
- Modify: `package.json`
- Move: `docs/superpowers/specs/2026-07-13-multilingual-relevance-baseline-design.md` to `docs/archive/specs/multilingual-relevance-baseline.md`
- Move: `docs/superpowers/plans/2026-07-13-multilingual-relevance-baseline.md` to `docs/archive/plans/multilingual-relevance-baseline.md`
- Test: `showcase/test/docs-site.test.ts`
- Test: `showcase/test/project-identity-policy.test.ts`

**Interfaces:**
- Produces: durable user/maintainer instructions and truthful roadmap state; leaves no tracked internal planning documents.

- [ ] **Step 1: Add failing durable-documentation expectations**

Update docs-site tests to require a Project navigation entry titled `Relevance baselines`. Keep the existing policy assertion that tracked `docs/superpowers/` is empty; it remains red until the final archive step.

Run: `pnpm exec vitest run --config showcase/vitest.config.ts showcase/test/docs-site.test.ts showcase/test/project-identity-policy.test.ts`

Expected: FAIL for the missing nav page and current tracked planning documents.

- [ ] **Step 2: Add commands and durable guidance**

Add root script `relevance: "pnpm build && pnpm --filter @ktjn/searchable-relevance evaluate"`. Document all-language and `--language`/`--k`/`--json` usage, metric definitions, source refresh review, license handling, per-query inspection, and the limits on comparing small suites. Add the page to Project navigation.

- [ ] **Step 3: Update roadmap truthfully**

Change the relevance status to say the initial native six-language harness and small regression suites are shipped. Retain representative domain corpora, broader judged sets, accepted thresholds, and CI regression enforcement as remaining work. Do not claim production-scale quality.

- [ ] **Step 4: Archive working records**

Create `docs/archive/plans/`, move the approved design and this plan to the archive paths above, and add an archived-status note at the top of each stating the implementation commit/PR and pointing to `docs/project/relevance-baselines.md`. Confirm `git ls-files docs/superpowers` returns no paths.

- [ ] **Step 5: Run the full verification matrix**

Run in order:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm build
pnpm typecheck
pnpm test
pnpm size
pnpm docs:check
pnpm relevance -- --json
git diff --check
```

Expected: every command exits 0; relevance output contains six suites; no generated report/site output is tracked.

- [ ] **Step 6: Run doc/spec review and commit**

Apply the repository doc-review workflow to the guide, roadmap, navigation, and archive links. Then commit:

```bash
git add package.json pnpm-lock.yaml packages/relevance docs showcase/docs-nav.ts showcase/test
git commit -m "docs: publish multilingual relevance baseline"
```

- [ ] **Step 7: Final truth check**

Run: `git status --short && git ls-files docs/superpowers && git log --oneline --decorate -8`

Expected: clean worktree, no `docs/superpowers` output, and reviewable task commits followed by the documentation/archive commit.
