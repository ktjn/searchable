# GOV.UK Learner-Driving Relevance Corpus Design

## Purpose

Add Searchable's second representative relevance domain: the GOV.UK "Learn to
drive a car" journey. This corpus complements the Searchable documentation
suite with public-service guidance, closely related tasks, transaction pages,
and vocabulary used by people learning to drive.

The slice adds evidence rather than tuning. It does not change ranking, define
a pass/fail threshold, enable a CI score gate, or claim broad public-sector
search quality.

## Scope

The suite is `govuk-learn-to-drive@1.0.0`, in English. Its inventory is the
journey hub plus these 21 internal destinations, for exactly 22 documents:

- `/learn-to-drive-a-car`;
- `/vehicles-can-drive`;
- `/legal-obligations-drivers-riders`;
- `/driving-eyesight-rules`;
- `/apply-first-provisional-driving-licence`;
- `/guidance/the-highway-code`;
- `/driving-lessons-learning-to-drive`;
- `/find-driving-schools-and-lessons`;
- `/government/publications/car-show-me-tell-me-vehicle-safety-questions`;
- `/theory-test/revision-and-practice`;
- `/take-practice-theory-test`;
- `/book-theory-test`;
- `/theory-test/what-to-take`;
- `/change-theory-test`;
- `/check-theory-test`;
- `/cancel-theory-test`;
- `/book-driving-test`;
- `/driving-test/what-to-take`;
- `/change-driving-test`;
- `/check-driving-test`;
- `/cancel-driving-test`;
- `/pass-plus`.

The external theory-test application is excluded. Neighboring driving pages
that are not linked from the journey are also excluded, keeping the selection
rule reproducible and reviewable.

The corpus contains exactly 20 task-oriented queries: 16 concise two-to-five
word searches and four longer natural questions. Queries cover seven topics:

- eligibility and eyesight;
- provisional licence;
- lessons and practice;
- theory preparation;
- theory-test management;
- practical-test management;
- after passing.

## Provenance and licensing

GOV.UK publishes the selected content under the Open Government Licence v3.0
except where a page states otherwise. The OGL permits reuse and requires
attribution to the information provider and source. The committed suite and
fixture notice record:

- publisher: Government Digital Service and the named publishing
  organisations exposed by the Content API;
- source title and journey URL;
- OGL v3.0 name and canonical licence URL;
- retrieval date;
- attribution to GOV.UK under the OGL;
- the exact journey-link selection and normalization method.

The refresh command validates exact GOV.UK origins and the fixture's expected
OGL provenance fields. The Content API does not expose per-page licence
metadata, so the initial snapshot and every refresh require a maintainer source
credit audit for stated exceptions. No logos, photographs, videos,
downloadable attachments, personal data, or third-party application content
are copied.

Authoritative sources:

- journey: <https://www.gov.uk/learn-to-drive-a-car>;
- reuse guidance: <https://www.gov.uk/help/reuse-govuk-content>;
- Content API documentation: <https://content-api.publishing.service.gov.uk/>;
- OGL v3.0: <https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/>.

## Domain-suite architecture

Domain fixtures move to a schema-version-2 discriminated corpus model:

```ts
type DomainCorpus =
  | {
      kind: "generated-index";
      pages: DomainPage[];
    }
  | {
      kind: "snapshot";
      documents: SnapshotDomainDocument[];
    };

interface SnapshotDomainDocument {
  id: string;
  url: string;
  title: string;
  description: string;
  body: string;
  contentHash: string;
}
```

Shared suite metadata, topics, queries, graded judgments, rationales, and
review metadata remain outside the corpus union. `searchable-docs` migrates to
`schemaVersion: 2` with `kind: "generated-index"`; its suite version, page
inventory, queries, judgments, metrics, and CLI behavior remain unchanged.

`govuk-learn-to-drive` uses `kind: "snapshot"`. Its normalized documents are
committed inside the suite fixture so ordinary evaluation is deterministic,
offline, and independent of GOV.UK availability.

The known-suite allowlist gains `govuk-learn-to-drive`. The existing
`--suite` selector remains the public CLI boundary, so evaluation is:

```sh
pnpm relevance -- --suite govuk-learn-to-drive
pnpm relevance -- --suite govuk-learn-to-drive --json
```

`--suite` and `--language` remain mutually exclusive. Default language-suite
execution remains unchanged.

## Snapshot normalization

The snapshot refresh reads the official Content API for the fixed journey URL.
It derives the 21 internal destination routes from
`details.step_by_step_nav.steps`, rejects external destinations, and compares
the derived inventory with the committed allowlist before fetching documents.

Each snapshot document keeps the selected public route as its stable `id` and
canonical GOV.UK URL, even when the API resolves multiple routes to one content
item. This matters for GOV.UK guides: for example,
`/theory-test/revision-and-practice` and `/theory-test/what-to-take` share the
`/theory-test` content item but select different entries from `details.parts`.
The normalizer chooses the part whose slug matches the requested route rather
than duplicating the full guide response. When the selected route equals a
guide's base path, it uses the first public part plus the shared title and
description.

Normalization has an explicit schema allowlist for the selected journey:
`step_by_step_nav`, `answer`, `transaction`, `guide`, `publication`, `manual`,
and `simple_smart_answer`. Each handler extracts only substantive user-facing
text from known fields. It removes HTML markup while preserving text
boundaries, decodes entities, collapses whitespace, and excludes navigation,
cookie notices, feedback forms, update histories, related links, and
attachments. An unknown schema or missing expected field is an error, not a
best-effort empty document.

`contentHash` is a lowercase SHA-256 digest of a canonical serialization of the
normalized title, description, and body. It identifies meaningful searchable
content drift without depending on API timestamps or JSON property order.

## Refresh workflow

Live network access is isolated in a manual maintenance command:

```sh
pnpm relevance:refresh -- --suite govuk-learn-to-drive --check
pnpm relevance:refresh -- --suite govuk-learn-to-drive --write --version 1.1.0 --source-credit-audit
```

`--check` fetches and validates all source content, then reports:

- journey destinations added, removed, redirected, or duplicated;
- content schema changes;
- title, description, body, and hash changes by route;
- licence or attribution changes.

It does not write. `--write` performs the same complete validation first and
then atomically replaces only the snapshot documents and retrieval metadata.
It never changes queries, topics, grades, or rationales. Any write resets
review metadata to `draft` and requires a fresh measured-result review before
publication. `--write` also requires an explicit `--version` that is a valid
semantic version and greater than the committed suite version; the command
stores that exact version rather than guessing the release significance.
`--source-credit-audit` is also required for writes as an explicit maintainer
attestation that the selected live pages were checked for stated licensing
exceptions which the Content API cannot expose.

HTTP failures, non-JSON responses, redirects outside `www.gov.uk`, inventory
drift, unexpected schemas, malformed content, duplicate routes, or fixture OGL
provenance changes abort the refresh without partial changes. Normal relevance
tests and evaluation never call the network.

## Evaluation

A generic domain runner dispatches on `corpus.kind`:

1. `generated-index` retains the current showcase-build, inventory-drift, and
   generated-index evaluation path;
2. `snapshot` adapts normalized documents to the existing `RelevanceSuite`
   model, builds a temporary index with `@ktjn/searchable-indexer`, serves it
   over loopback HTTP, and searches it with the public `SearchClient`;
3. both paths reuse the existing evaluator, deterministic report ordering, MRR,
   Precision@k, Recall@k, nDCG@k, and zero-result rate;
4. temporary files, clients, and servers are cleaned up in `finally`.

The CLI loads and validates the selected suite before preparation. It builds
the showcase only for `generated-index`; selecting a snapshot suite must not
invoke the showcase build.

Snapshot evaluation uses lexical mode, English analysis, `worker: false`,
strict manifest validation, and default `k = 5`. Domain scores remain
non-comparable across corpora because source material and judgments differ.

## Judgments and review

Grades retain their established meanings:

- `3`: directly answers the search intent;
- `2`: materially helps answer the intent;
- `1`: useful supporting context;
- `0` or omission: not relevant.

Every positive judgment has a nonblank, page-specific rationale, and rationale
keys match positive judgment keys exactly. Closely related tasks use multiple
relevant pages where justified. Query wording is authored for plausible search
behavior rather than copied wholesale from page titles.

The initial fixture is agent-assisted and starts as `draft`. Before it can be
marked `reviewed`, the maintainer examines all normalized documents, every
query, grade, rationale, returned top-five list, and aggregate metric. Review
metadata records the method, reviewer, and ISO date.

Metrics are published as a reproducible baseline, not a threshold. Query text
may receive one representativeness calibration before review, but wording must
not be changed merely to inflate aggregate scores. Ranking changes are a
separate roadmap decision.

## Testing

Implementation follows red-green-refactor cycles. Tests cover:

- schema-version-2 validation and migration of `searchable-docs`;
- mutual exclusivity and validation of generated and snapshot corpus fields;
- known-suite loading and CLI dispatch for both domain kinds;
- journey-link extraction, fixed inventory enforcement, and external-link
  exclusion;
- schema-specific normalization for every selected GOV.UK content type;
- guide-part selection by requested route;
- HTML-to-text normalization and deterministic content hashing;
- duplicate, redirect, malformed-payload, unexpected-schema, HTTP, and OGL
  provenance failures;
- `--check` no-write behavior and atomic `--write` behavior;
- automatic reset from reviewed metadata to draft after a refresh write;
- exact fixture counts, topic coverage, query-length mix, attribution,
  rationales, hashes, and review state;
- a real offline integration through the indexer, loopback server, and public
  client without mocked ranking.

Live GOV.UK access is not a CI dependency. Refresh tests use representative
captured API payloads; only the explicit maintenance command performs network
requests. Publication retains the full repository gates: lint, build,
typecheck, unit tests, bundle size, documentation validation, browser tests,
both domain evaluations, and `git diff --check`.

## Documentation and roadmap

`docs/project/relevance-baselines.md` gains the GOV.UK command, scope,
provenance, review method, measured baseline, refresh workflow, and
interpretation limits. `packages/relevance/fixtures/NOTICE.md` gains the OGL
attribution and licence boundary.

After human review, `docs/project/roadmap.md` records two representative
domains while retaining broader domains, user-query evidence, quality
thresholds, performance evidence, and CI enforcement as remaining work. The
design and implementation plan are archived under `docs/archive/` when the
slice is complete.

## ADR impact

No ADR changes are required. The discriminated corpus model and refresh command
are private relevance-evaluation tooling; they do not change the published
index format, client or indexer API, ranking model, deployment boundary, or
runtime architecture. If snapshot-domain support later becomes a public API or
affects shipped index semantics, that expansion requires its own ADR.

## Explicit non-goals

- changing BM25, analyzers, boosts, synonyms, fuzzy matching, or hybrid fusion;
- adding a relevance threshold or required CI score check;
- using GOV.UK analytics or user-query logs;
- evaluating latency, memory, or index download size;
- indexing neighboring driving guidance outside the fixed journey;
- fetching live GOV.UK content during ordinary tests or evaluation;
- copying attachments, media, or third-party content;
- adding a showcase UI, public package API, dependency, or release.
