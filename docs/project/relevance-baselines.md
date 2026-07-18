# Relevance baselines

Searchable includes a deterministic lexical relevance evaluator for every full
language profile: English (`en`), German (`de`), Swedish (`sv`), Dutch (`nl`),
Bokmål (`nb`), and Nynorsk (`nn`). It exercises the public indexer and client
APIs over local HTTP, using committed native-language FAQ and help excerpts.
Four reviewed domain suites evaluate the generated Searchable documentation
index, a normalized snapshot of the GOV.UK learner-driving journey, a
German-language corpus of Wikipedia articles on driving-license law, and a
faceted Project Gutenberg public-domain fiction corpus.

## Run the baseline

From the repository root:

```sh
pnpm relevance
```

For machine-readable output:

```sh
pnpm relevance -- --json
```

Run a single language with `--language`, for example:

```sh
pnpm relevance -- --language sv
```

Run the documentation-domain suite separately:

```sh
pnpm relevance -- --suite searchable-docs
```

Its machine-readable report includes the aggregate and per-query results:

```sh
pnpm relevance -- --suite searchable-docs --json
```

Run the GOV.UK learner-driving suite in the same ordinary offline evaluator:

```sh
pnpm relevance -- --suite govuk-learn-to-drive
```

For its per-query report:

```sh
pnpm relevance -- --suite govuk-learn-to-drive --json
```

Run the German driving-license-law suite the same way:

```sh
pnpm relevance -- --suite de-fahrerlaubnisrecht
```

Run the Gutenberg faceted-fiction suite the same way:

```sh
pnpm relevance -- --suite gutenberg-fiction-facets
```

`--suite` and `--language` are mutually exclusive. The default command remains
the six-language regression baseline.

Evaluation performs no external network access. Suite sources, licenses,
attribution, and selection notes are recorded with the fixtures in
`packages/relevance/fixtures/`. Only the explicit GOV.UK refresh workflow uses
the network.

## Metrics

Each report includes:

- mean reciprocal rank (MRR), which rewards the first relevant result appearing early;
- Precision@k, the relevant share of the first `k` result positions;
- Recall@k, the share of judged relevant documents found in the first `k` positions;
- nDCG@k, which accounts for graded relevance and result order;
- zero-result rate, the share of queries returning no documents.

The default cutoff is `k = 5`. JSON output contains per-query returned document IDs and metrics as well as suite-level means, making changes reviewable and suitable for later automation.

## Reviewed documentation corpus

`searchable-docs@1.1.0` covers all 29 generated documentation pages with 20
English task-oriented queries across setup, indexing and deployment, lexical
features, internationalization, offline and worker execution, relevance, and
vector and hybrid search. Seventeen queries are concise two-to-five-word
searches; three longer queries preserve strict-AND stress coverage.

Judgments use grade `3` for a direct answer, `2` for material help, `1` for
supporting context, and omission or `0` for no relevance. Every positive grade
has a page-specific rationale. Maintainer `ktjn` reviewed every query, grade,
rationale, and measured top-five result on 2026-07-13.

The reviewed baseline at `k = 5` is:

| Metric | Value |
|---|---:|
| MRR | 0.650000 |
| Precision@5 | 0.170000 |
| Recall@5 | 0.304167 |
| nDCG@5 | 0.468992 |
| Zero-result rate | 0.200000 |

This is a reproducible comparison point, not a pass/fail threshold. A metric
change requires per-query inspection and an explanation; the aggregate alone
does not determine whether a ranking change is acceptable.

## Reviewed GOV.UK learner-driving corpus

`govuk-learn-to-drive@1.1.0` contains the 22 public pages in GOV.UK's “Learn to
drive a car” journey: the journey hub and its 21 internal destinations
(unchanged from `1.0.0`). It has 28 English task-oriented queries across seven
topics: eligibility and eyesight, provisional licences, lessons and practice,
theory preparation, theory-test management, practical-test management, and
after passing.

Twenty of the 28 queries are the original authored queries from `1.0.0`. The
remaining 8 are sourced from Google's public, unauthenticated autocomplete
suggestion endpoint (`suggestqueries.google.com/complete/search`), used as
phrasing inspiration for authoring genuine evaluation queries — **this is not
a licensed dataset**, unlike the GOV.UK OGL content itself, and it is not a
GOV.UK search-query log: GOV.UK does not publish query-log data. Each
candidate suggestion was screened against the corpus for genuine
answerability and non-duplication with existing queries, hand-graded against
the real documents, and reviewed for vocabulary grounding (several needed
rewording so their significant terms appear in the judged documents' literal
text before being added). Example new query ids: `glasses-need-to-drive`,
`learners-motorway`, and `lessons-after-passing`. Full sourcing detail,
including rejected candidates and the vocabulary-grounding review, is in
`docs/superpowers/notes/2026-07-17-govuk-real-query-candidates.md`.

The suite uses the same graded judgment and page-specific rationale policy as
the documentation corpus. Maintainer `ktjn` reviewed every normalized
document, query, grade, rationale, and measured top-five result on 2026-07-18.

The reviewed baseline at `k = 5` is:

| Metric | `1.0.0` (20 queries) | `1.1.0` (28 queries) |
|---|---:|---:|
| MRR | 0.650000 | 0.732143 |
| Precision@5 | 0.160000 | 0.171429 |
| Recall@5 | 0.475000 | 0.464286 |
| nDCG@5 | 0.585738 | 0.642698 |
| Zero-result rate | 0.300000 (6/20) | 0.214286 (6/28) |

The `1.1.0` aggregate is measurably better than `1.0.0` on every metric except
a small dip in recall, despite the 8 added queries being harder and more
naturally phrased (several are longer, informally-worded questions rather
than concise keyword searches) — see the source note above for the per-query
vocabulary-grounding risks that were identified and, where needed, addressed
before this baseline was recorded.

The source snapshot was retrieved on 2026-07-13. It contains public sector
information licensed under the [Open Government Licence
v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
Normalization retains allowlisted main-text fields from the GOV.UK Content API
and excludes attachments, media, and the external theory-test application.
Every document records a SHA-256 hash of its normalized title, description,
and body so meaningful source drift is reviewable independently of API
timestamps or JSON property order.

Check the live journey and normalized content without changing the fixture:

```sh
pnpm relevance:refresh -- --suite govuk-learn-to-drive --check
```

Refreshes are manual maintenance operations, not part of ordinary evaluation.
A write requires a semantic version greater than the committed suite version
and an explicit source-credit audit confirming that no page-level licensing
exception applies to the reused main text:

```sh
pnpm relevance:refresh -- --suite govuk-learn-to-drive --write --version 1.1.0 --source-credit-audit
```

A write fetches the fixed journey sequentially, validates its exact route
inventory and GOV.UK origins, writes atomically, and resets the suite to
`draft`. Review all changed hashes and normalized documents, rerun the JSON
report, and record a fresh reviewer and review date before treating the new
version as a baseline. Increment the version whenever documents, queries,
judgments, grades, or rationales change.

## Reviewed German domain corpus

`de-fahrerlaubnisrecht@1.0.0` contains 23 normalized documents drawn from
German Wikipedia's `Kategorie:Fahrerlaubnisrecht (Deutschland)` category and a
few buffer-list swaps made during normalization. It has 19 German
task-oriented queries across five topics: license classes and eligibility,
fitness-to-drive and the MPU exam, penalties and license withdrawal, the
probationary period, and special permits and courses.

The suite uses the same graded judgment and page-specific rationale policy as
the documentation and GOV.UK corpora. Maintainer `ktjn` reviewed every
normalized document, query, grade, rationale, and measured top-five result on
2026-07-17.

The reviewed baseline at `k = 5` is:

| Metric | Value |
|---|---:|
| MRR | 0.855263 |
| Precision@5 | 0.284211 |
| Recall@5 | 0.517544 |
| nDCG@5 | 0.690330 |
| Zero-result rate | 0.052632 |

The source snapshot was retrieved on 2026-07-17. It contains German Wikipedia
article text licensed under [CC BY-SA
4.0](https://creativecommons.org/licenses/by-sa/4.0/), attributed to Wikipedia
contributors with edit history available via each source page. Selection
notes recording the category listing, discarded stubs/overlaps, and buffer
swaps are recorded in the fixture's `provenance` field.

## Reviewed Gutenberg facets domain corpus

`gutenberg-fiction-facets@1.0.0` contains 30 real Project Gutenberg
public-domain books across 5 real Gutenberg bookshelf genres (Gothic Fiction,
Science Fiction, Adventure, Detective Fiction, Children's Literature),
published 1764-1929. It has 20 English task-oriented queries across five
topics: genre browsing, publication era, author-and-title lookup,
plot-and-theme search, and cross-genre comparison. Each document carries a
`genre` terms facet and a `year` range facet; 7 of the 20 queries apply a real
facet filter (a `genre` terms filter, a `year` range filter, or both together).

This is the first corpus in this project to exercise judged relevance under
facet-filtered search rather than free-text search alone. For example,
`gothic-castle-genre-filter` applies a `genre: "Gothic Fiction"` terms filter,
`castle-pre-1800` applies a `year: { max: 1800 }` range filter, and
`gothic-castle-before-1780` combines both — a `genre: "Gothic Fiction"` terms
filter intersected with a `year: { max: 1780 }` range filter — narrowing the
corpus to the single correctly-judged match (The Castle of Otranto, 1764) and
correctly excluding The Mysteries of Udolpho (1794), which matches the genre
and the "castle" text but falls outside the narrower year cutoff. This
exercises real facet intersection, not just independent single-value filters,
because genre and publication year deliberately cross-cut in the underlying
corpus (e.g. Gothic Fiction spans 1764-1897).

The suite uses the same graded judgment and page-specific rationale policy as
the documentation, GOV.UK, and German corpora. Maintainer `ktjn` reviewed
every normalized document, query, grade, rationale, and measured top-five
result on 2026-07-17.

The reviewed baseline at `k = 5` is:

| Metric | Value |
|---|---:|
| MRR | 1.000000 |
| Precision@5 | 0.360000 |
| Recall@5 | 1.000000 |
| nDCG@5 | 0.960733 |
| Zero-result rate | 0.000000 |

The source snapshot was retrieved on 2026-07-17. It contains Project
Gutenberg bibliographic metadata and text, in the public domain in the United
States, attributed to Project Gutenberg. Selection notes recording the
bookshelf sources, genre/year cross-cutting rationale, and the mix of
verbatim-excerpt and summary documents are recorded in the fixture's
`provenance` field and in
`docs/superpowers/notes/2026-07-17-gutenberg-facets-source-selection.md`.

## Interpretation and limits

The language suites are small regression fixtures, and the four domain suites
are reviewed but intentionally narrow corpora. They verify that content can be
indexed and retrieved through the shipped public path and provide a
reproducible signal when ranking or analysis changes. They are not
production-scale benchmarks.

The language suites use one strongly relevant document per native source
question or help topic. The domain suites use graded multi-page judgments, but
cover only one English documentation site, one UK learner-driving journey, one
German-language encyclopedia corpus, and one English-language faceted fiction
catalog — four domains across two languages (English and German). Only the
Gutenberg facets corpus exercises facet-filtered search under judged
relevance; the other three domains judge free-text search only. Facet
*counts* (`facetValues()`) remain unexercised by any relevance suite. Their
queries are authored intents rather than user-query logs, with one exception:
8 of the 28 `govuk-learn-to-drive` queries are sourced from Google
autocomplete suggestions as real-world phrasing inspiration (see that
section above). This is a proxy for real search language, not query-log
evidence — GOV.UK does not publish query logs, and an informal, unauthenticated
autocomplete endpoint is not equivalent to production search analytics.
These scores are
not latency or memory evidence and do not establish web-scale quality or
superiority over another engine. Do not compare scores across suites because
their source material, query sets, and judgments differ.

The German suite's one remaining zero-result query (out of 19) is an accepted
lexical-matching limitation rather than a defect: this project's search
performs strict AND across query terms with no compound-word splitting and no
stopword filtering, which can miss a match when a query's terms are split
across a German compound word in the indexed text.

There are deliberately no pass/fail score thresholds yet. Before relevance
becomes a CI gate, the project still needs broader representative domains,
larger judged query sets informed by real query evidence, and an explicit
policy for acceptable metric
movement. Latency, memory, and other resource measurements remain a separate
roadmap concern.

## Extending coverage

Keep domain-specific suites separate from generic engine conformance tests. A new or expanded suite should:

- use representative, license-compatible source material;
- preserve source URL, license URL, attribution, retrieval date, and selection notes;
- contain native-language queries and reviewed graded judgments;
- remain deterministic and runnable without external network access;
- explain its domain and limits before its metrics are used as a quality gate.

When the generated documentation page inventory changes, update the page list
and affected judgments together; the domain runner reports missing pages and
title drift before evaluation. Re-run the JSON report and review every changed
top-five result. Increment the suite version whenever queries, page inventory,
grades, or rationales change, and record a fresh reviewer and review date before
committing the new baseline.
