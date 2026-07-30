# Vector and hybrid search

This guide describes the implemented vector storage, brute-force similarity, reciprocal-rank fusion, and embedding integration.

## Chunking

The Python `searchable-indexer` (`searchable_indexer.vectors.chunk_text`) is the canonical chunker: word-based sliding windows, 200 words per chunk with 20-word overlap by default, configurable per build via `build_index`'s `vector_window`/`vector_overlap` options. It runs at index-build time, not in the TS client.

## Storage format

A vector index records dimensions, `float32` or `int8` quantization, the embedding provider, and one shard per language. Building one requires the Python indexer's `build_index` to be called with an `embed` callable (`Callable[[list[str]], list[list[float]]]`) — no embedding model is bundled with `searchable-indexer` itself, so the caller supplies one (a local model, a remote API call, or anything else that returns vectors). `embedding_provider` (a passthrough metadata dict — `{"type": "local-model", "model": ...}`, `{"type": "remote-api"}`, or `{"type": "custom"}`) records what was used, for `SearchClientOptions.embedQuery`'s own provider-mismatch validation at query time. `vector_quantization` (`"int8"` default, or `"float32"`), `vector_window`, and `vector_overlap` are also `build_index` options. `write_index` then writes the resulting shards conditionally, same as every other optional shard type.

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
