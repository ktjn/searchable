# Vector & Hybrid Search

**Status**: Storage/similarity mechanics implemented, and option 1 below
(ship a local model) is now implemented too — see
[09-roadmap.md](09-roadmap.md)'s Phase 8 for what's actually built
(`packages/indexer/src/build-vectors.ts`, `packages/indexer/src/chunk-text.ts`,
`packages/client/src/vector-search.ts`,
`packages/indexer/src/transformers-embed.ts`,
`packages/client/src/transformers-embed.ts`) vs. still design-only below
(option 2, a remote embedding API; binary quantization; IVF clustering;
WASM scoring). The design below is unchanged from when it was written;
each section is annotated with what's real today.

Flagged as an open question in [09-roadmap.md](09-roadmap.md); Orama
supports vector and hybrid (lexical + vector) search natively (via
`@orama/plugin-embeddings`), so this is a real feature gap worth a
concrete design rather than a deferred musing — this doc is that design.
It stays an **opt-in plugin** (`plugin:vector`), consistent with the
"pay only for what you use" principle in
[00-overview.md](00-overview.md#guiding-principles): a deployment with no
vector field pays zero bytes and zero code for this.

## What it's for

BM25F + synonyms ([04](04-query-ranking-boosts.md), [05](05-synonyms.md))
handles lexical and known-synonym matches well, but not conceptual/
paraphrase similarity — a query for "how do I cancel my plan" won't
lexically match a doc titled "Closing your account" without an explicit
synonym entry for every such pair. Embedding-based nearest-neighbor
search finds semantically close content without hand-authored synonym
coverage, and is also the retrieval step needed if this index is ever
used as the retrieval half of a RAG pipeline.

## The hard constraint: where does the query embedding come from?

Building embeddings for the corpus is easy — it happens **offline, at
index time**, same as everything else in
[01-architecture.md](01-architecture.md#offline-the-indexer), so it can
freely use whatever's convenient (a local model, a hosted embedding API
call during the build) since build time already isn't a "no backend"
environment.

The problem is **query time**: turning the user's typed query into a
vector requires running *the same embedding model* that built the index,
and by default this project's whole premise is that query time has no
backend to call out to. Two real options, not a false choice:

1. **Ship a small embedding model to the browser** (default, matches the
   project's philosophy) — a quantized sentence-embedding model run via
   ONNX Runtime Web / transformers.js-style WASM inference, loaded lazily
   only when `plugin:vector` is actually used. Realistic budget: small
   sentence-embedding models quantized to int8 land in the ~20-90MB
   range — large relative to the rest of this project's KB-scale budgets
   ([08-modern-features.md](08-modern-features.md#bundle-size-budget)),
   but it's a one-time, cached, lazy-loaded download, not part of the
   core bundle, and comparable to what any client-side embedding
   solution (Orama's browser demos included) actually costs.
   **Implemented**: `createTransformersEmbedder()`
   (`packages/indexer/src/transformers-embed.ts`) for the offline/build-time
   half and `createTransformersEmbedQuery()`
   (`packages/client/src/transformers-embed.ts`) for the query-time half,
   both backed by `@huggingface/transformers` (ONNX Runtime under the
   hood), defaulting to `Xenova/all-MiniLM-L6-v2` (384-dim, int8/`q8` by
   default). The client half is a `devDependency` + optional
   `peerDependency` only, loaded via a lazy `import()` evaluated on first
   use, and listed in `packages/client/vite.config.ts`'s
   `rollupOptions.external` — so a deployment that never calls
   `createTransformersEmbedQuery()` pays nothing toward the 15KB core
   bundle budget. **Caveat on how this was verified**: this session's
   sandbox has organizational egress policy blocking `huggingface.co`
   (where `@huggingface/transformers` fetches model weights from on first
   use), so the batching/slicing/lazy-load-caching *plumbing* is tested
   with a mocked `pipeline` (`packages/indexer/test/transformers-embed.test.ts`,
   `packages/client/test/transformers-embed.test.ts`), not a real model
   download — each test file also has an explicitly opt-in test (gated
   behind `CSF_TEST_REAL_TRANSFORMERS=1`, skipped by default) that
   exercises the real library end-to-end wherever network access to
   `huggingface.co` is actually available (e.g. a contributor's own
   machine, or a CI runner without this sandbox's restriction).
2. **Call an external embedding API at query time** (explicit, documented
   opt-out from the static-only guarantee, not the default) — for
   deployments that already accept a backend dependency elsewhere and
   would rather not ship a model to the browser. This must be clearly
   labeled as breaking the "no query-time backend" property the rest of
   this design promises, not quietly allowed to blur that line.

The manifest records which mode a given index's vectors were built for
(`embeddingProvider: { type: "local-model", model: "...", dims: 384 }`
vs `{ type: "remote-api" }`) so the runtime can tell a caller "this index
needs a remote embedding endpoint configured" rather than failing
opaquely.

## Chunking

**Implemented** (`packages/indexer/src/chunk-text.ts`'s `chunkText()`,
defaults `DEFAULT_CHUNK_TOKENS = 200`/`DEFAULT_CHUNK_OVERLAP_TOKENS = 20`,
called from `build-vectors.ts` on each document's title+body text). A
whitespace-word split, not `@csf/analysis`'s stemmed tokens — an
embedding model wants natural surface text, not an already-destemmed bag
of words.

Whole documents are usually too long for a single embedding to represent
well. At index time, long text fields are split into overlapping
**passages** (configurable size/overlap, e.g. ~200 tokens with ~20-token
overlap) before embedding; each passage gets its own vector and a
back-reference to its parent document id. A document can therefore
surface in vector search results via any one of its passages, with the
result resolving back to the parent doc for rendering (same doc-store
lookup as lexical results,
[02-index-format.md](02-index-format.md#doc-store-shard)).

## Storage format

**Implemented**, with one deliberate difference from the sketch below:
`buildVectorShards()`/`writeIndex()` write one vector shard *per
language* (`vectors/<lang>.<hash>.json`, `Manifest.vectors.shards: {lang:
file}`), matching the `pins`/`synonyms`/`fuzzy` per-language shape,
rather than per doc-id-range shard — a corpus-size-driven refinement
(doc-id-range sharding within a language) that hasn't been needed yet,
same as the doc store's own current single-shard-per-partition state.
`dims`/`quantization`/`embeddingProvider` live on `Manifest.vectors`
(corpus-wide, since one index has one embedding space); each shard's own
`dims`/`quantization`/`quantRange`/`entries` mirror the shape below.
`"binary"` quantization is not implemented (see below).

A new shard type, same directory-of-shards pattern as everything else:

```
dist/index/
  vectors/<shard>.<hash>.json   # or a binary tier, see below
```

```jsonc
// vectors/0.9b21.json
{
  "dims": 384,
  "quantization": "int8",     // "float32" | "int8" | "binary"
  "entries": [
    { "passageId": "41-0", "docId": 41, "vector": [12, -34, 87, /* ... */] }
  ]
}
```

- **float32**: exact, largest (4 bytes/dim). Implemented — stores
  `embed()`'s raw output as-is (JS/JSON numbers are already
  float64-precision, so this is really "no quantization applied").
- **int8 scalar quantization** (default): per-shard min/max scaling to
  8-bit integers, ~4x smaller, negligible recall loss for this use case
  — the right default given the project's size-consciousness.
  Implemented (`packages/indexer/src/build-vectors.ts`'s
  `quantizeInt8()`, `packages/client/src/vector-search.ts`'s
  `dequantizeVector()`).
- **binary quantization** (1 bit/dim, ~32x smaller): usable as a coarse
  first pass to shortlist candidates before a full-precision rescore on
  a much smaller set, worth offering as an advanced option for very
  large corpora rather than a general default (meaningful recall cost).
  Not implemented — still a future opt-in, not this slice.

Vectors are sharded by doc-id range (like the doc store), not by term —
there's no natural "prefix" to shard vectors by, so the sharding purpose
here is purely keeping any single fetch bounded in size, not enabling
lookup-by-key the way term-prefix sharding does. **As implemented**,
sharding today is per-language only (see "Storage format" above) — real
doc-id-range sharding *within* a language is the same not-yet-needed
refinement the doc store itself is still missing, deferred until a
concrete corpus actually needs it.

## Similarity search strategy

- **Brute-force cosine similarity** (default): Implemented
  (`packages/client/src/vector-search.ts`'s `bruteForceVectorSearch()`) —
  without the WASM-accelerated scoring path mentioned below, which
  remains a future opt-in like the lexical core's own
  `plugin:wasm-core`. Compute the query vector's
  dot product against every stored vector. This sounds naive but is
  simple, exact, and fast enough for corpora up to roughly the low
  hundreds of thousands of passages, especially with a WASM-accelerated
  scoring path (same `plugin:wasm-core` pattern as lexical scoring,
  [08-modern-features.md](08-modern-features.md#optional-wasm-core)) —
  it's a fixed-cost-per-vector dot product, not a complex data structure,
  which fits the "simplest thing that meets the bar" principle in
  [00-overview.md](00-overview.md#guiding-principles).
- **Coarse clustering (IVF-style) for larger corpora** (opt-in beyond
  the brute-force threshold, tuned empirically via
  [10-testing-and-performance.md](10-testing-and-performance.md)):
  at build time, k-means-cluster the vectors and store cluster
  centroids in the manifest plus a `cluster → passage ids` shard; a
  query only fetches/scores vectors in the nearest few clusters instead
  of the whole corpus. This trades a small recall cost for bounded fetch
  size, same shape as the lexical sharding tradeoff.
- **Deliberately not a full HNSW graph** as the default: HNSW gives
  better recall/latency at large scale, but a serialized navigable-graph
  format is meaningfully more complex to build, ship, and — critically
  for this project's other stated goal — much harder to reproduce from
  a plain Python/Node/Java script than "flat vectors plus optional
  centroids" is
  ([02-index-format.md](02-index-format.md#the-format-is-a-spec-not-a-library-dependency)).
  Worth a future opt-in plugin if a concrete corpus proves clustering
  insufficient, not a day-one requirement.

## Hybrid search: combining lexical and vector scores

**Implemented** (`packages/client/src/vector-search.ts`'s
`reciprocalRankFusion()`, `packages/client/src/search.ts`'s
`fuseHybridResult()`) — both fusion modes described below, RRF default
and the weighted-score override via `options.vectorWeight`. Pinned hits
(docs/16) are carried over unchanged and excluded from fusion entirely —
an editorial override, not a similarity-ranking candidate.

Lexical BM25F scores and vector cosine similarities are on incomparable
scales, so naive weighted-sum combination is fragile. Default fusion
method is **Reciprocal Rank Fusion (RRF)**: run both searches
independently, then combine by rank position rather than raw score —
`fusedScore(doc) = Σ 1 / (k + rank_in_result_set)` summed across the
lexical and vector result lists (`k` a small constant, e.g. 60, standard
in IR literature). This is picked deliberately over score normalization
schemes (min-max, z-score) because it needs no calibration and no
assumptions about either score distribution, matching the "simple over
clever" principle — a weighted-score hybrid mode remains available for
callers who want to hand-tune the tradeoff, but RRF is the default.

## API surface

**Implemented**, matching the sketch below exactly
(`packages/client/src/client.ts`, `packages/client/src/search.ts`) —
plus `SearchClientOptions.embedQuery` (see "The hard constraint" above),
the seam a caller wires a real embedding source into.

```ts
const result = await client.search("how do I cancel my plan", {
  mode: "hybrid",          // "lexical" (default) | "vector" | "hybrid"
  vectorWeight: 0.5,       // only used if mode overrides RRF with weighted fusion
});
```

`mode: "vector"` requires `plugin:vector` to be registered and a query
embedding source configured (local model or remote API per the manifest,
see above) — attempting vector/hybrid mode without one throws a clear
`VectorSearchNotConfiguredError` rather than silently falling back to
lexical-only.

## Non-goals

- Not competing with a dedicated vector database at tens-of-millions-of-
  vectors scale — same reasoning as the general non-goals in
  [00-overview.md](00-overview.md#non-goals): past a certain scale, a
  hosted vector store is the right tool.
- Not shipping a specific embedding model as a hard dependency — the
  design is model-agnostic (manifest records dims/provider); which model
  to embed with is a deployment choice, not baked into this project.
- Not attempting cross-lingual semantic search as a v1 guarantee — most
  small open embedding models are strongest within a single language or
  a limited multilingual set; correctness here rides on whatever model
  the deployment chooses, not on anything this project adds on top.

## Where this fits in the roadmap

Added as **Phase 8** in [09-roadmap.md](09-roadmap.md), after the core
lexical engine (Phases 1-6) is built and tested, since it's additive and
higher-risk/higher-complexity than the rest of the design — validating
the lexical engine end-to-end first de-risks the project before taking
on embedding-model bundling and ANN tuning.
