# 2026-07-13 Multilingual Relevance Baseline Design

> **Archived:** Implemented on `feature/multilingual-relevance-baseline`. Current operating guidance and limitations are maintained in [Relevance baselines](../../project/relevance-baselines.md).

## Purpose

Searchable needs a reproducible relevance baseline before it can make or enforce search-quality claims. This slice adds a small end-to-end evaluation system for every full language profile: English (`en`), German (`de`), Swedish (`sv`), Dutch (`nl`), Bokmål (`nb`), and Nynorsk (`nn`).

The baseline is a regression and measurement foundation, not a production-scale benchmark. It records observed quality without introducing CI thresholds. Performance, memory, and network measurements remain a separate roadmap slice.

## Scope

This slice will:

- add a dedicated workspace package for relevance evaluation;
- evaluate the public TypeScript indexer and client path rather than private scoring functions;
- vendor one small, deterministic, native-language judged suite for each full language profile;
- calculate MRR, Precision@k, Recall@k, nDCG@k, and zero-result rate;
- emit readable and machine-readable deterministic reports;
- validate fixture structure, provenance, licensing, and language coverage;
- document how to run and interpret the baseline.

This slice will not:

- establish pass/fail relevance thresholds;
- add performance benchmarks or latency claims;
- compare Searchable with other engines;
- add translated or model-generated text as native-language evidence;
- add fallback-segmenter languages;
- change ranking, analysis, or public search behavior.

## Architecture Decision Impact

No ADR change is required. This design adds repository-internal evaluation tooling and test data, uses the existing public indexer and client boundaries, and does not change the product architecture, index format, ranking model, compatibility policy, or public API. A future change that makes relevance configuration public or alters ranking behavior must be evaluated separately against the existing ADRs.

## Package Boundary

Create `packages/relevance` as an internal workspace package. Relevance evaluation is separate from engine conformance because it measures the quality of ordered results, while conformance tests verify correctness and cross-implementation agreement.

The package has five responsibilities:

1. define and validate judged-suite data;
2. compute ranking metrics as pure functions;
3. run a suite through the public Searchable indexer and client APIs;
4. discover and evaluate committed language suites;
5. render deterministic console and JSON reports.

It must not import private files from another package's `src` tree. It consumes the same package exports available to a normal Searchable user.

## Native-Language Fixture Policy

Each language suite is built from an official or otherwise authoritative native-language FAQ/help source whose license explicitly permits redistribution and modification. A source is acceptable only when all of these conditions hold:

- the publisher produced the material in the suite's language rather than exposing an automatic translation;
- the source contains native question-and-answer or equivalent help-topic pairs;
- the license permits committing the selected material to this repository;
- required attribution and share-alike notices can be satisfied in the fixture metadata and repository documentation;
- the retrieved source and license are publicly inspectable.

Each source question becomes a judged query. Its corresponding answer or help topic becomes a relevant document, while other answers in that language suite act as realistic distractors. When one question legitimately maps to more than one answer, judgments may use multiple documents and graded relevance.

The committed suite is the reproducible input. Evaluation and tests never fetch live source pages. Every suite records:

- stable suite ID and schema version;
- Searchable language code;
- publisher and source title;
- canonical source URL;
- license identifier and license URL;
- retrieval date;
- attribution text;
- a note explaining how questions and answers were selected;
- documents, judged queries, and relevance grades.

Source text may be normalized only mechanically: remove navigation, markup, duplicated boilerplate, and unrelated page chrome; preserve the native wording and meaning. The fixture must not silently rewrite, translate, or improve source language. A future refresh changes the suite version and is reviewed like a data change.

## Data Model

`schema.ts` defines these conceptual types:

```ts
type SupportedBaselineLanguage = "en" | "de" | "sv" | "nl" | "nb" | "nn";
type RelevanceGrade = 0 | 1 | 2 | 3;

interface RelevanceDocument {
  id: string;
  title: string;
  body: string;
  url: string;
}

interface JudgedQuery {
  id: string;
  text: string;
  judgments: Record<string, RelevanceGrade>;
}

interface SuiteProvenance {
  publisher: string;
  sourceTitle: string;
  sourceUrl: string;
  license: string;
  licenseUrl: string;
  retrievedAt: string;
  attribution: string;
  selectionNotes: string;
}

interface RelevanceSuite {
  schemaVersion: 1;
  id: string;
  version: string;
  language: SupportedBaselineLanguage;
  provenance: SuiteProvenance;
  documents: RelevanceDocument[];
  queries: JudgedQuery[];
}
```

Grades have fixed semantics: `0` is explicitly not relevant, `1` is marginally relevant, `2` is relevant, and `3` is highly relevant. Unjudged documents are treated as not relevant for this small, fully controlled corpus. A document counts as relevant for binary metrics when its grade is at least `1`.

## Validation

`validate-suite.ts` validates a parsed suite before indexing. It rejects:

- an unsupported schema version or language code;
- missing or blank provenance fields;
- invalid retrieval dates or non-HTTP(S) provenance URLs;
- duplicate document or query IDs;
- empty document titles/bodies or query text;
- judgments that reference unknown document IDs;
- grades outside the integers `0` through `3`;
- queries with no positively relevant document;
- suites with no documents or no queries.

Errors identify the suite and the offending document, query, judgment, or field. Fixture validation is deterministic and performs no network access.

## Metric Semantics

`metrics.ts` exposes pure functions over an ordered list of returned document IDs, a judgment map, and cutoff `k`. The evaluator defaults to `k = 5`; callers may choose another positive integer.

- **Reciprocal rank:** `1 / rank` of the first result with grade at least `1`, or `0` when none is returned. MRR is the arithmetic mean across queries.
- **Precision@k:** relevant returned documents in the first `k` positions divided by `k`. If fewer than `k` hits are returned, the missing positions are non-relevant.
- **Recall@k:** relevant returned documents in the first `k` positions divided by the total number of positively relevant documents in the query judgments.
- **nDCG@k:** DCG uses gain `2^grade - 1` and discount `log2(rank + 1)`. Divide by the ideal DCG for the query at the same cutoff. Validation guarantees at least one positive grade, so ideal DCG is non-zero.
- **Zero-result rate:** queries for which search returns no hits divided by all evaluated queries.

Duplicate returned document IDs are an evaluation error because they indicate an invalid engine result rather than a meaningful ranking. Results beyond `k` do not affect cutoff metrics, but the runner requests enough results to calculate the configured cutoff.

The suite report includes per-query metrics and arithmetic means across queries. It does not pool documents across queries when calculating aggregates.

## Public-API Runner

`searchable-runner.ts` converts suite documents into ordinary indexer sources using the suite language, builds an index in a temporary directory, opens it through the public client API, and executes every judged query using normal lexical search.

Document IDs returned by the client must map stably to fixture document IDs. The mapping is part of runner setup and never inferred from result order. Temporary artifacts are removed after success or failure.

An indexing, client, or query failure is rethrown with suite language and query ID context while preserving the original error as its cause. A successful query that returns no hits is evaluation data, not an execution error.

The first baseline evaluates default lexical behavior. Fuzzy, synonym, phrase, vector, and hybrid modes can gain separate suites later without changing the metric layer.

## CLI and Reports

`cli.ts` provides a repository command that:

- evaluates all six suites by default;
- accepts `--language <code>` to select one full profile;
- accepts `--k <positive integer>`, defaulting to `5`;
- accepts `--json` for machine-readable output;
- discovers only committed suites from the package fixture directory;
- processes languages and queries in stable sorted order.

The console report shows language, suite version, corpus size, query count, cutoff, aggregate metrics, and provenance. The JSON report additionally includes every query's returned IDs, grades, and metric values. Numeric output uses a fixed documented precision so repeated runs on the same commit produce byte-for-byte identical JSON apart from no timestamps being included.

The command exits non-zero for invalid arguments, invalid fixtures, indexing/search failures, or incomplete language coverage. Low metric values do not cause failure in this slice.

## Testing

Metric unit tests use rankings with hand-calculated expected values and cover:

- the relevant document at ranks one and later;
- multiple relevant documents;
- graded relevance and ideal ordering for nDCG;
- fewer than `k` results;
- relevant documents omitted from the returned cutoff;
- no-result queries;
- duplicate returned IDs;
- invalid cutoff values.

Validation tests cover every rejection rule and one complete valid suite. Integration tests run a miniature judged suite through the real public indexer/client path and verify the returned report rather than mocking search.

CLI tests verify language selection, stable ordering, JSON shape, argument errors, and deterministic serialization. Fixture-policy tests require exactly one committed baseline suite for each of `en`, `de`, `sv`, `nl`, `nb`, and `nn`, validate every suite, and ensure suite IDs and language declarations agree with their filenames.

The repository's normal build, typecheck, lint, and test gates cover the new package. Documentation checks cover links to the relevance guide and source/license records.

## Documentation and Interpretation

Add a project guide explaining how to run all suites or one language, read each metric, refresh a source, and review a fixture change. It must state prominently that:

- these are small native-language regression suites, not representative web-scale benchmarks;
- scores from different suites are not directly comparable because corpus difficulty differs;
- a metric change requires inspecting per-query results before changing ranking behavior;
- CI thresholds should be introduced only after baseline results are reviewed and accepted;
- source licenses and attribution remain attached to redistributed fixture text.

Update the roadmap to mark the initial multilingual relevance harness and baseline suites complete while retaining representative corpora, broader judged-query sets, and regression thresholds as future work.

## Acceptance Criteria

The slice is complete when:

1. all six full language profiles have committed native-source suites with complete provenance and redistribution-compatible licenses;
2. every suite passes structural and coverage validation without network access;
3. all five metrics match hand-calculated unit-test expectations;
4. a real public-API integration run evaluates a miniature suite successfully;
5. the CLI evaluates one language or all languages and emits deterministic console and JSON reports;
6. the initial all-language report is reproducible from a clean checkout;
7. documentation clearly limits the claims that may be made from these small suites;
8. build, typecheck, lint, unit, integration, and documentation checks pass.
