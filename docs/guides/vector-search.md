# Vector and hybrid search

This guide describes the implemented vector storage, brute-force similarity, reciprocal-rank fusion, and embedding integration.

## Chunking

`buildVectorShards` extracts and chunks source documents internally, using 200-token chunks with 20-token overlap by default. The exported `chunkText` helper supports custom pipelines.

## Storage format

A vector index records dimensions, `float32` or `int8` quantization, the embedding provider, and one shard per language. Pass the `BuiltVectors` result to `writeIndex`.

## The hard constraint: where does the query embedding come from?

The same embedding space must be used at build and query time.

Configure `SearchClientOptions.embedQuery` with either a function or `{ embed, provider }`. The object form validates provider metadata by default. `createTransformersEmbedQuery` and `createTransformersEmbedder` provide optional, lazily loaded local-model adapters; custom and remote embeddings remain injectable.

## API surface

```ts
const result = await search.search("how do I deploy this?", {
  mode: "hybrid",
  limit: 10,
});
```

## Hybrid search: combining lexical and vector scores

`mode: "vector"` ranks by cosine similarity. `mode: "hybrid"` combines lexical and vector rankings with reciprocal-rank fusion; editorial pins stay in front. Missing vector configuration throws `VectorSearchNotConfiguredError`, and mismatched provider metadata throws `VectorProviderMismatchError`.

The current vector scan is local and brute force, appropriate for modest static corpora. A public semantic showcase is tracked in the [roadmap](../project/roadmap.md).
