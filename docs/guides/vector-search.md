# Vector and hybrid search

This guide describes the implemented vector storage, brute-force similarity, reciprocal-rank fusion, and embedding integration.

## Chunking

The Python `searchable-indexer` (`searchable_indexer.vectors.chunk_text`) is today's default chunker: word-based sliding windows, 200 words per chunk with 20-word overlap by default, configurable per build via `build_index`'s `vector_window`/`vector_overlap` options. It runs at index-build time, not in the TS client. It's a simple, general-purpose splitter, not a structure-aware chunker — a future RAG-oriented use case may need something smarter (heading/section boundaries, sentence-aware splitting), which would likely be a different, opt-in strategy rather than a change to this one.

`build_vector_shards`/`build_index` validate the embedder's output: the returned vector count must match the input text count, every vector must share the same positive dimensionality, and every value must be a finite number (not a bool). `vector_quantization`, `vector_window`, and `vector_overlap` are validated too (`vector_window` must be positive, `vector_overlap` must be `0 <= overlap < window`).

## Storage format

A vector index records dimensions, `float32` or `int8` quantization, the embedding provider, and one shard per language. `int8` quantization stores each value as a JSON integer in `0`–`255`, scaled against the shard-wide `quantRange.min`/`quantRange.max` (not signed two's-complement int8, despite the name — the name matches the existing shard-format/schema naming and isn't being changed here).

Building a vector index requires the Python indexer's `build_index` to be called with an `embed` callable (`Callable[[list[str]], list[list[float]]]`) — no embedding model is bundled with `searchable-indexer` itself, so the caller supplies one (a local model, a remote API call, or anything else that returns vectors). `embedding_provider` (a passthrough metadata dict — `{"type": "local-model", "model": ...}`, `{"type": "remote-api"}`, or `{"type": "custom"}`) is **required** whenever `embed` is set — it records what was used, for `SearchClientOptions.embedQuery`'s own provider-mismatch validation at query time, and without it query-time provider compatibility can't be established. `write_index` then writes the resulting shards conditionally, same as every other optional shard type, and independently re-validates that every language shares the same dimensionality and quantization before writing the manifest.

Each vector entry's `passageId` (`"<docId>-<chunkIndex>"`) is stable only as long as the document's internal id and the chunking parameters don't change — it is not yet a stable public citation identifier. A future RAG-oriented consumer that needs to cite a specific passage durably (across re-chunks, or outside this index's own id space) will likely need an external document id, a content hash, or another stable chunk identifier; that's not implemented yet.

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
