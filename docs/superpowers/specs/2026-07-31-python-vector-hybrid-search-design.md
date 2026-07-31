# Python Vector and Hybrid Search Design

## Goal

Add dependency-light vector and hybrid query support to the Python
`searchable-client`, using an injected `embed_query(text) -> list[float]`
callable and the existing Searchable vector-shard contract. Keep the client
transport-agnostic and leave model/runtime integrations to applications or
future optional packages.

## Scope

The Python client will support:

- loading per-language vector shards from `manifest.vectors.shards`;
- int8 dequantization and float32 pass-through;
- cosine similarity with safe handling of zero vectors;
- one best-scoring vector passage per document;
- lexical/vector Reciprocal Rank Fusion (RRF), with the established default
  constant `k=60`;
- optional normalized weighted hybrid merging through `vector_weight`, for
  parity with the TypeScript client;
- explicit query-embedding configuration, vector-availability,
  dimensionality, shard, and provider-compatibility errors;
- Python unit, integration, and conformance-oriented tests;
- updated Python API, architecture, vector-search, README, changelog, and
  release documentation;
- a minor Python package release and a verified PyPI artifact/publication path.

## API

`SearchClient` accepts an optional `embed_query` argument. It may be a bare
callable or a mapping containing `embed` and an optional JSON-compatible
`provider` descriptor. `SearchOptions` gains `mode` with values `lexical`,
`vector`, and `hybrid`, plus optional `vector_weight`.

The provider descriptor is metadata only. When supplied, it must structurally
match `manifest.vectors.embeddingProvider` unless provider validation is
explicitly disabled. No model is loaded, selected, or managed by this
package.

## Query behavior

Lexical search remains unchanged. Vector search embeds the query, validates
the vector dimension against the manifest, loads the selected language shard,
dequantizes entries, scores all passages, collapses them to the best passage
per document, and retrieves stored documents. Vector-only mode has no lexical
candidate requirement. Hybrid mode runs the existing lexical pipeline and
vector retrieval independently, then fuses their ranked document IDs. Existing
pins, filters, facets, highlights, and total-hit semantics remain governed by
the established TypeScript behavior and Python lexical implementation.

## Errors

Public error types will distinguish:

- vector/hybrid mode without an injected query embedder;
- vector/hybrid mode against an index without vectors or a language shard;
- a declared query provider that differs from the index provider;
- query-vector dimension mismatches;
- malformed vector-shard data, including inconsistent dimensions or missing
  int8 quantization metadata.

Errors are deliberate: an explicit semantic-search request must not silently
degrade to lexical search or return rankings from an incompatible embedding
space.

## Verification

Tests will first cover vector primitives and error cases, then exercise
vector-only and hybrid queries against deterministic generated fixtures. The
existing Python client suite, cross-implementation fixture checks, package
lint/type checks, and release artifact inspection remain required gates.

## Release boundary

The implementation is a minor Python-client feature release because it adds
new optional query behavior without changing the existing lexical API or the
index format. The package remains dependency-light with `searchable-analysis`
as its runtime dependency only.
