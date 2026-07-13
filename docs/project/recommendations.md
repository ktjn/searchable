# Recommendations

This document captures practical recommendations for improving Searchable without changing its core product boundary: build-time indexing and browser-side search over public, immutable content.

## Priorities

### 1. Publish reproducible performance evidence

The architecture is credible, but production guidance needs measured limits.

Add benchmarks for:

- 1k, 10k, 100k, and 1M documents
- cold-cache and warm-cache searches
- p50 and p95 query latency
- bytes fetched per query
- total index size and shard count
- peak browser heap usage
- low-end mobile devices
- prefix, fuzzy, phrase, facet, and hybrid queries
- vector search at several vector counts and dimensions

Publish the corpus generator, benchmark configuration, browser versions, and raw results. Avoid performance claims without reproducible evidence.

Recommended outcome:

- documented supported ranges
- explicit warning thresholds
- guidance for shard sizing
- guidance for enabling optional features

### 2. Introduce an explicit query plan

The query path currently coordinates retrieval, expansion, filtering, scoring, facets, pins, document loading, and hybrid merging. Move these decisions behind an internal query-plan abstraction before adding more features.

Suggested shape:

```ts
interface QueryPlan {
  retrieval: RetrievalNode;
  filters: FilterNode[];
  scoring: ScoringNode;
  collectors: CollectorNode[];
}
```

The planner should decide:

- rarest-term-first intersections
- filter pushdown
- shard fetch order
- lexical and vector parallelism
- when full candidate materialization is required
- whether facets require a separate candidate pass
- when top-k early termination is safe

Keep the planner internal until multiple real consumers require a stable extension API.

### 3. Add corpus-tested language profiles

English and German profiles are a good start, but fallback segmentation is not equivalent to full language support.

Add a language only when the repository includes:

- representative corpus fixtures
- expected tokenization and normalization fixtures
- stopword tests
- stemming or lemmatization tests
- relevance queries with expected ordering
- TypeScript and Python conformance tests

Swedish is a useful next profile:

- Unicode-aware tokenization
- Swedish stopwords
- Swedish Snowball stemming
- accent-preserving normalization
- compound-word test cases

Do not silently apply English analysis to unsupported languages.

### 4. Make ranking parameters configurable

The current BM25F defaults are sensible, but global hardcoded values limit tuning.

Support configuration such as:

```ts
interface RankingConfiguration {
  k1?: number;
  fields: Record<string, {
    boost?: number;
    b?: number;
  }>;
}
```

Field-specific length normalization is useful because titles, tags, headings, and body text have different length distributions.

Keep defaults stable. Record ranking configuration in the manifest so results remain reproducible.

### 5. Define vector-search scale boundaries

Brute-force vector search is appropriate for small static corpora. It should remain the default until measurements show a need for more complexity.

Document:

- recommended maximum vector count
- expected memory cost
- expected query latency by vector dimension
- model download cost
- browser compatibility constraints

Evaluate these optimizations only from benchmark evidence:

- vector quantization
- coarse clustering
- lexical candidate generation followed by vector reranking
- optional HNSW or WASM-based ANN
- prefiltered vector candidate sets

Avoid making ANN a mandatory dependency.

### 6. Strengthen the public-index security boundary

All generated index files are downloadable. Query privacy does not imply corpus confidentiality.

Add a prominent warning to getting-started and indexing documentation:

> Treat every indexed field, posting, facet value, stored document, synonym, pin, and vector as public data.

Explicitly prohibit indexing:

- unpublished documents
- authorization-sensitive metadata
- hidden CMS fields containing restricted data
- per-user content
- secrets or internal identifiers

Access-controlled search requires a different deployment architecture with server-side authorization and query execution.

### 7. Add relevance evaluation as a first-class quality gate

Correctness tests do not detect ranking regressions.

Create small judged query sets for each supported language and domain. Track at least:

- MRR
- Precision@k
- Recall@k
- nDCG@k
- zero-result rate

Run relevance evaluation when changing:

- analyzers
- tokenization
- stemming
- synonym behavior
- fuzzy expansion
- BM25 parameters
- field boosts
- hybrid fusion

Keep domain-specific relevance suites separate from generic engine conformance tests.

### 8. Publish operational guidance

Document recommended configurations for common deployments:

- small documentation site
- medium CMS export
- large public knowledge base
- offline-first application
- lexical-only search
- hybrid search

For each profile, specify:

- enabled features
- expected index size
- shard strategy
- cache policy
- worker usage
- Service Worker usage
- memory expectations

## Recommended sequence

1. Add performance and relevance baselines.
2. Document security and scale boundaries.
3. Introduce the internal query planner.
4. Make ranking configuration manifest-driven.
5. Add Swedish with full conformance and relevance fixtures.
6. Optimize vector retrieval only after measured need.

## Non-goals

Do not weaken the current product boundary by adding:

- query-time backend dependencies
- browser-side index mutation
- mandatory WASM
- application-framework coupling
- access-control semantics over public static shards
- speculative plugin APIs without a concrete consumer

The current static, immutable, browser-first architecture is the main differentiator. Preserve it.