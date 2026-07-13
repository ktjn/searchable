# Relevance baselines

Searchable includes a deterministic lexical relevance evaluator for every full language profile: English (`en`), German (`de`), Swedish (`sv`), Dutch (`nl`), Bokmål (`nb`), and Nynorsk (`nn`). It exercises the public indexer and client APIs over local HTTP, using committed native-language FAQ and help excerpts.

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

The evaluator performs no external network access. Suite sources, licenses, attribution, and selection notes are recorded with the fixtures in `packages/relevance/fixtures/`.

## Metrics

Each report includes:

- mean reciprocal rank (MRR), which rewards the first relevant result appearing early;
- Precision@k, the relevant share of the first `k` result positions;
- Recall@k, the share of judged relevant documents found in the first `k` positions;
- nDCG@k, which accounts for graded relevance and result order;
- zero-result rate, the share of queries returning no documents.

The default cutoff is `k = 5`. JSON output contains per-query returned document IDs and metrics as well as suite-level means, making changes reviewable and suitable for later automation.

## Interpretation and limits

These suites are small regression fixtures, not production-scale benchmarks. They verify that native-language content can be indexed and retrieved through the shipped public path, and they provide a reproducible signal when ranking or analysis changes.

The suites currently use one strongly relevant document per native source question or help topic. Their scores are therefore not evidence of web-scale quality, domain coverage, latency, memory use, or superiority over another engine. Scores across languages are not directly comparable because each suite has different source material and judgments.

There are deliberately no pass/fail score thresholds yet. Before relevance becomes a CI gate, the project still needs broader judged query sets, representative domain corpora, reviewed judgments, and an explicit policy for acceptable metric movement. Performance and resource measurements remain a separate roadmap concern.

## Extending coverage

Keep domain-specific suites separate from generic engine conformance tests. A new or expanded suite should:

- use representative, license-compatible source material;
- preserve source URL, license URL, attribution, retrieval date, and selection notes;
- contain native-language queries and reviewed graded judgments;
- remain deterministic and runnable without external network access;
- explain its domain and limits before its metrics are used as a quality gate.

