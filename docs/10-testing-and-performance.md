# Testing, Regression & Performance

Three distinct concerns, kept as three distinct suites so a performance
regression and a correctness regression are never conflated in the same
report, and so each suite can run on its own cadence (correctness on
every commit, performance on a schedule/before releases where noisy
timing data is less disruptive to a PR feedback loop).

## 1. Correctness tests

**Unit level** (per module: tokenizer, stemmer, BM25F scorer, synonym
expander, facet aggregator, fuzzy matcher):
- Pure functions with tabular test cases — given input, exact expected
  output. Cheap, fast, run on every commit.
- Property-based tests where they pay off (e.g. "tokenizing then
  re-joining never drops non-whitespace characters silently," "BM25F
  score is monotonically non-decreasing in term frequency holding
  everything else fixed," "fuzzy match at distance 0 is always the
  literal term").

**Golden-file analysis tests** (see
[03-tokenization-i18n.md](03-tokenization-i18n.md#testing-strategy)):
- One fixture file per supported language: representative sentences →
  expected token stream (post-normalization, post-stemming). Run against
  *both* the indexer's and runtime's analysis entry points to guarantee
  they are the same pipeline, not just similar ones — this is the single
  highest-value regression test in the whole system, since an
  index/query analysis mismatch silently breaks matching with no error
  thrown anywhere.

**End-to-end / integration tests** (against the fixture corpus from
Roadmap Phase 0):
- Build a real index from the fixture corpus (through the reference
  indexer), load it with the real runtime, and assert on full query →
  result behavior: exact match, phrase match, prefix match, fuzzy match,
  synonym expansion, field boost changes result order, document boost
  changes result order, facet filter narrows results correctly, facet
  counts are contextually correct, multi-language partitioning returns
  only same-language results unless "all languages" is requested.
- **Cross-implementation conformance**: since the format is an open spec
  ([02-index-format.md](02-index-format.md#the-format-is-a-spec-not-a-library-dependency)),
  the same fixture corpus is also indexed by the Python and Java example
  generators, and the *same* end-to-end query assertions are run against
  indexes built by all three producers. This is both a correctness test
  and the proof that the format is genuinely implementation-agnostic —
  if the Python-built index doesn't satisfy the same assertions as the
  Node-built one, the spec has an ambiguity that needs fixing, not a bug
  to patch around in one implementation.

**Regression suite / snapshot corpus:**
- A fixed, versioned "known queries → known result sets + scores"
  snapshot over the fixture corpus, checked into the repo. Any change to
  ranking math, tokenization, or index format that shifts a snapshot
  result must be an intentional, reviewed diff (like a UI screenshot
  test) — this is what catches "someone tweaked `k1` and every ranking
  test three files away silently changed" class of regressions.
- Snapshots are per-feature-area (a ranking snapshot set, a facets
  snapshot set, an i18n snapshot set, a synonyms snapshot set) so a
  reviewer looking at a diff immediately knows which subsystem moved.

## 2. Performance test suite

Kept separate from correctness CI because timing is noisy in shared CI
runners; runs on a schedule (nightly) and required before tagging a
release, with results tracked over time (not just pass/fail against a
fixed threshold) so gradual regressions are visible even if no single
run crosses an alert threshold.

**Micro-benchmarks** (module level, e.g. `bench/scoring.bench.ts`):
- Posting-list intersection throughput at varying list sizes.
- BM25F scoring throughput per 10k candidate docs.
- Fuzzy dictionary lookup latency.
- Tokenization throughput per language (some languages, e.g. CJK
  segmentation, are meaningfully more expensive than whitespace
  splitting — worth tracking per language, not just an aggregate).

**Macro-benchmarks** (whole-query, against generated synthetic corpora
at several sizes — 1k / 10k / 100k / 1M documents — so the suite shows
*scaling behavior*, not just a single data point):
- Time-to-first-result for a cold client (manifest fetch → first
  keystroke result) — the metric that most directly maps to perceived
  UX quality.
- Time-to-result for a warm client (shards already cached).
- Shard bytes fetched per query, at each corpus size — this is the load-
  bearing metric for the "sharding keeps first-query cost roughly flat
  as the corpus grows" claim in
  [02-index-format.md](02-index-format.md#size-targets--sharding-tuning);
  a regression here (shard fetch size growing with corpus size) is
  exactly the failure mode the sharding design exists to prevent, so
  it's tested explicitly rather than assumed.
- Facet count computation latency at high facet-value cardinality.
- Bundle size (already gated in CI per
  [08-modern-features.md](08-modern-features.md#bundle-size-budget), but
  also tracked longitudinally here alongside runtime perf so a bundle-
  size/runtime-speed tradeoff made in one PR is visible next to the
  other release-readiness numbers, not off in a separate report nobody
  correlates with the perf data).

**Resource-citizenship checks** (see
[18-resource-aware-loading.md](18-resource-aware-loading.md)):
- Long Tasks API assertion: no single task attributable to this engine
  (worker or main-thread proxy) exceeds 50ms during a realistic query
  burst — a citizenship regression (e.g. someone removes a time-slicing
  yield point) shows up here, not just as a vague "feels janky" report.
- Mocked `navigator.connection` test confirming speculative fetches
  (`preload()`, facet prefetch) are actually skipped under simulated
  `saveData`/slow-connection conditions, not merely documented as
  skipped.
- Concurrency-cap assertion: a query needing many shards never exceeds
  the configured max simultaneous in-flight requests.

**Environment realism:**
- Macro-benchmarks run in an actual headless browser (not just Node)
  since `Intl.Segmenter` availability/performance, Web Worker overhead,
  and real `fetch`/HTTP-cache behavior all differ from a Node-only
  simulation — a Node-only perf suite would systematically understate
  real-world cost/benefit of the sharding and worker design.
- Synthetic corpora are generated with a documented, seeded generator
  (reproducible) covering a realistic term-frequency distribution
  (Zipfian, not uniform-random tokens) since uniform-random text produces
  unrealistically easy/hard posting-list sizes and would give misleading
  benchmark numbers.

## 3. What "done" looks like for a feature

No feature in this design is considered complete without:
1. Unit tests for its core logic.
2. At least one end-to-end fixture-corpus assertion exercising it through
   the real client API.
3. A regression snapshot entry if it affects ranking/result-set output.
4. A performance benchmark if it's on the query hot path (analysis,
   scoring, fetch, facet aggregation) — not required for one-time
   build-time-only indexer code, where correctness matters far more than
   speed.

This checklist is intentionally the same shape as the "simple but
powerful" principle in [00-overview.md](00-overview.md#guiding-principles):
a feature that's too complicated to write a golden-file test or a
benchmark for is a signal to simplify the feature, not to skip the test.
