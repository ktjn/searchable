# Relevance baselines

Searchable includes a deterministic lexical relevance evaluator for every full language profile: English (`en`), German (`de`), Swedish (`sv`), Dutch (`nl`), Bokmål (`nb`), and Nynorsk (`nn`). It exercises the public indexer and client APIs over local HTTP, using committed native-language FAQ and help excerpts. A separate reviewed domain suite evaluates the generated Searchable documentation index.

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

`--suite` and `--language` are mutually exclusive. The default command remains
the six-language regression baseline.

The evaluator performs no external network access. Suite sources, licenses, attribution, and selection notes are recorded with the fixtures in `packages/relevance/fixtures/`.

## Metrics

Each report includes:

- mean reciprocal rank (MRR), which rewards the first relevant result appearing early;
- Precision@k, the relevant share of the first `k` result positions;
- Recall@k, the share of judged relevant documents found in the first `k` positions;
- nDCG@k, which accounts for graded relevance and result order;
- zero-result rate, the share of queries returning no documents.

The default cutoff is `k = 5`. JSON output contains per-query returned document IDs and metrics as well as suite-level means, making changes reviewable and suitable for later automation.

## Reviewed documentation corpus

`searchable-docs@1.0.0` covers all 28 generated documentation pages with 20
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

## Interpretation and limits

The language suites are small regression fixtures, and the documentation suite
is one reviewed domain corpus. They verify that content can be indexed and
retrieved through the shipped public path and provide a reproducible signal
when ranking or analysis changes. They are not production-scale benchmarks.

The language suites use one strongly relevant document per native source
question or help topic. The domain suite uses graded multi-page judgments, but
it covers only one English documentation site and uses authored intents rather
than user-query logs. These scores are not evidence of web-scale quality,
latency, memory use, or superiority over another engine. Do not compare scores
across suites because their source material, query sets, and judgments differ.

There are deliberately no pass/fail score thresholds yet. Before relevance
becomes a CI gate, the project still needs additional representative domains,
broader judged query sets, and an explicit policy for acceptable metric
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
