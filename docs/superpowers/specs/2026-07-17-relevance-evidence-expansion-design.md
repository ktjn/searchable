# Relevance evidence expansion — design

Status: approved for planning
Date: 2026-07-17
Related roadmap item: `docs/project/roadmap.md` — "Expand relevance coverage beyond
the documentation and learner-driving domains with broader judged sets and
real query evidence before defining thresholds or making production-scale
claims."

## Goal

Expand the project's judged relevance evidence as part of 1.0 scope, in two
phases:

1. Add judged domain corpora beyond the existing two (Searchable docs,
   GOV.UK learner-driving), covering gaps in the current evidence.
2. Layer real (non-authored) query evidence into the existing GOV.UK suite.

This is scoped as 1.0-required work, not deferred near-term roadmap work.

## Current state

- Two reviewed domain corpora exist: `searchable-docs@1.1.0` (29 pages, 20
  English authored queries, no real facets exercised) and
  `govuk-learn-to-drive@1.0.0` (22 pages, 20 English authored queries, no
  real facets exercised).
- Six language regression suites (`en`, `de`, `sv`, `nl`, `nb`, `nn`) exist,
  but they are small synthetic FAQ fixtures, not graded multi-page domain
  corpora.
- All existing judged evidence is English-domain and query-authored (not
  drawn from real usage).
- Neither existing domain corpus stresses facets (terms, range, hierarchical)
  under judged relevance.

## Gaps this design closes

1. No non-English domain corpus with graded judgments over real content.
2. No domain corpus exercising real facet usage.
3. No real (non-authored) query evidence anywhere in the relevance suite.

## Phase 1 — two new judged domain corpora

### Domain A: non-English domain corpus (German)

- Language: German (`de`), chosen because it has the most mature stemmer
  support among the non-English profiles.
- Source: a public, license-compatible German-language site (government or
  public-sector preferred, matching the GOV.UK precedent). Exact source
  selection and license vetting is an implementation-time task, not fixed
  in this spec.
- Size and methodology: same shape as the existing two corpora — roughly
  20-30 pages, ~20 native-language task-oriented queries, graded 3/2/1/omit-0
  judgments with a page-specific rationale for every positive grade.

### Domain B: faceted-content domain corpus

- Content type: a public site with real terms, range, and hierarchical
  facets in production use (e.g., category + price/date range) — a public
  library catalog, open government dataset/service directory, or similar.
  Exact source selection happens at implementation time.
- Size and methodology: same shape as the existing two corpora.
- Requires queries that specifically exercise faceted retrieval (filtered
  and aggregate-bucket facet calls), not just free-text search.

### Fixture format and methodology (both domains)

No new mechanism — reuse existing conventions exactly:

- Fixtures live in `packages/relevance/fixtures/`.
- Suites are semantically versioned.
- Judgments use grade `3` (direct answer), `2` (material help), `1`
  (supporting context), omission/`0` (no relevance) — every positive grade
  has a page-specific rationale.
- Every document records a SHA-256 hash of normalized content.
- A named maintainer and review date are recorded once reviewed, before the
  suite is treated as a baseline.
- Source URL, license URL, attribution, retrieval date, and selection notes
  are recorded alongside the fixtures.
- No network access during ordinary evaluation; only an explicit
  `--refresh`-style workflow touches the network, following the existing
  GOV.UK refresh pattern.

### Evaluator / CLI integration

- Both suites plug into the existing `pnpm relevance -- --suite <name>`
  runner exactly as `searchable-docs` and `govuk-learn-to-drive` do — no new
  CLI surface.
- Domain B's facet queries require the evaluator to report on facet-related
  results (e.g., whether an expected facet value/bucket was present), which
  the evaluator does not currently do. Whether this needs a schema/reporting
  extension to `packages/relevance` is an open question for the
  implementation plan to resolve — not decided in this spec.

## Phase 2 — real query evidence

- Source: GOV.UK's published site-search top-query data, scoped to the
  learner-driving journey pages already covered by `govuk-learn-to-drive`.
- Mechanism: this is a version bump of the existing
  `govuk-learn-to-drive` suite (not a new suite), following the already
  documented refresh/versioning workflow in
  `docs/project/relevance-baselines.md` (`pnpm relevance:refresh -- --suite
  govuk-learn-to-drive --write --version <next> --source-credit-audit`).
- Real queries are re-judged against the same graded rubric as the existing
  authored queries. Existing authored queries may be kept, replaced, or
  supplemented with real queries — the exact mix is an implementation-time
  editorial decision, reviewed the same way as any other suite change.
- No new infrastructure for query sourcing is introduced. Approaches
  considered and rejected: scraping/using an unrelated public IR benchmark
  (domain mismatch with static CMS/content-site use case) and a live user
  study (no infrastructure or user base for an unreleased library).

## Review and versioning

- Each new or changed suite requires a fresh named reviewer and review date
  before being treated as a baseline, matching current practice.
- `docs/project/roadmap.md`, `docs/project/relevance-baselines.md`, and
  `CHANGELOG.md` are updated once each phase merges, to keep the roadmap the
  single current source of relevance-evidence status.

## Out of scope

- Defining pass/fail relevance quality thresholds or a CI relevance gate
  (explicitly still open per the roadmap; this design only expands evidence).
- The query-planner abstraction, performance/benchmark evidence, and the
  semantic-search example — each is a separate roadmap item with its own
  spec.
- Adding new full language profiles (analyzer fixtures, stopword/stemming
  tests, cross-implementation conformance) — Domain A reuses the already
  shipped German profile; it does not add a new one.
