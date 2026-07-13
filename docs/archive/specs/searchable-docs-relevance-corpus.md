# Searchable Documentation Relevance Corpus Design

> Archived after implementation on `feat/searchable-docs-relevance-corpus`.
> Durable operating guidance is in [Relevance baselines](../../project/relevance-baselines.md).

## Purpose

Add the first representative domain relevance corpus to Searchable. The corpus
measures lexical ranking over the same generated documentation index published
by the GitHub Pages showcase. It complements the six small native-language
Wikipedia-help regression suites with a deeper English documentation corpus,
natural task-oriented queries, multiple relevant pages, and reviewable graded
judgments.

This slice records evidence. It does not change ranking, define pass/fail
thresholds, or make production-scale quality claims.

## Scope

The corpus covers the generated Searchable documentation site, currently about
28 curated pages. It contains 20 English queries spanning:

- setup and first-search tasks;
- indexing and deployment;
- facets, synonyms, fuzzy matching, pins, and highlighting;
- internationalization;
- worker and offline execution;
- relevance evaluation;
- vector and hybrid search.

At least five queries must have more than one positively judged page. Queries
use natural task or problem wording rather than copied page titles.

The slice adds no dependency, public API, ranking configuration, release
change, or showcase UI.

## Architecture

The generated documentation index under `showcase/dist/search-index` is the
corpus under test. The evaluator builds the documentation site before running,
serves the generated files over loopback HTTP, and queries the index through
the public `SearchClient` with lexical search. Page URLs are the stable result
identifiers used by judgments.

The domain fixture lives at
`packages/relevance/fixtures/domains/searchable-docs.json`. It stores corpus
page inventory, provenance and review metadata, queries, judgments, and
rationales. It does not duplicate rendered page bodies.

Domain suites remain additive and separate from the six language baselines.
The existing baseline fixture files, default evaluator behavior, metrics, and
report structure remain unchanged.

## Domain suite model

The fixture has its own validated model with:

- `schemaVersion: 1`;
- a stable suite `id` and semantic `version`;
- `language: "en"`;
- provenance identifying the Searchable documentation repository, canonical
  site, license, retrieval date, attribution, and selection method;
- review metadata containing status and method, plus reviewer and review date
  when status is `reviewed`;
- a page inventory of stable URL and title pairs;
- 20 judged queries;
- `0..3` judgments keyed by page URL;
- a nonblank rationale for every positive judgment.

Positive-judgment keys and rationale keys must match exactly. A query must have
at least one positive judgment. Every referenced page must exist in the page
inventory, and the page inventory must match the generated documentation index.

Review metadata starts with `status: "draft"`, with reviewer and review date
omitted. The suite can be described as reviewed only after the maintainer
examines the queries, grades, and rationales. At that point the status changes
to `reviewed` and the fixture records the maintainer identity and ISO review
date.

## Judgment policy

Grades have fixed meanings:

- `3`: directly answers the search intent;
- `2`: materially helps answer the intent;
- `1`: provides useful supporting context;
- `0` or omission: not relevant.

Rationales explain why each positively judged page deserves its grade. They
must describe the relationship between query intent and page content rather
than restating the numeric grade.

The first draft is agent-assisted. Human review is a required completion gate,
not inferred from generated metrics or passing tests.

## Loading and execution

The relevance CLI gains `--suite searchable-docs`. This selector resolves only
known fixtures beneath `packages/relevance/fixtures/domains`; it is not an
arbitrary filesystem path. `--suite` and `--language` are mutually exclusive.
Without `--suite`, current all-language and `--language` behavior is unchanged.

The domain runner:

1. builds the showcase documentation and search index;
2. validates the domain fixture;
3. verifies that fixture page URLs and generated index page URLs match;
4. serves `showcase/dist` on `127.0.0.1` with an ephemeral port;
5. opens the generated manifest through `SearchClient` with `worker: false`,
   strict validation, and lexical mode;
6. maps returned hits to their canonical page URLs;
7. evaluates the existing MRR, Precision@k, Recall@k, nDCG@k, and zero-result
   metrics;
8. disposes the client and closes the server in `finally`.

The existing deterministic text and JSON report shapes are reused. Domain and
language reports are structurally consistent, but their scores are not
presented as directly comparable.

## Failure behavior

The command fails with specific messages for:

- an unknown domain suite;
- simultaneous `--suite` and `--language` selectors;
- missing or invalid generated index files;
- malformed provenance or review metadata;
- duplicate page or query identifiers;
- judgments targeting unknown pages;
- positive judgments without matching rationales;
- rationales without matching positive judgments;
- page inventory drift between the fixture and generated site;
- HTTP or search failures, with suite and query context preserved.

Cleanup runs even when validation, HTTP, or search fails.

## Testing

Implementation follows red-green-refactor cycles.

Unit tests cover domain-suite validation, exact rationale-key policy, CLI
selection and conflicts, known-suite loading, and actionable page-drift errors.
An integration test builds or uses a real generated documentation index, serves
it over HTTP, executes `SearchClient`, and verifies stable URL-based results
without mocking the indexer, fetch, or client.

A committed fixture policy test requires:

- exactly 20 queries;
- 17 concise two-to-five-word searches plus three six-to-seven-word stress
  queries, preserving task intent without copying page titles;
- coverage of the documented topic groups;
- at least five multi-relevant queries;
- complete positive-judgment rationales;
- complete provenance and review metadata;
- exact agreement with the generated page inventory.

The full repository verification remains lint, build, typecheck, unit tests,
bundle size, documentation checks, browser tests, relevance evaluation, and
`git diff --check`.

## Documentation and roadmap

`docs/project/relevance-baselines.md` documents the new command, corpus scope,
judgment method, review metadata, measured results, maintenance process, and
interpretation limits.

After human judgment review, `docs/project/roadmap.md` records that the first
representative documentation corpus exists. It continues to list additional
domains, broader judged sets, thresholds, and CI score enforcement as remaining
work.

The design and implementation plan are archived under `docs/archive/` when the
slice is complete, following the repository's established planning policy.

## Explicit non-goals

- tuning BM25, analyzers, boosts, or hybrid fusion;
- adding a score threshold or required CI relevance check;
- benchmarking latency, memory, or index size;
- adding another language profile or multilingual domain corpus;
- changing the published documentation UI;
- publishing npm packages or creating a release.
