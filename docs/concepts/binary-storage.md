# Binary storage

This page records the implemented binary storage tier, why it coexists with JSON, and where lazy decoding provides a measured benefit.

Binary encodings are available for term shards, fuzzy deletion dictionaries, and document-store shards. Each begins with a versioned directory that maps a requested key or document ID to byte offsets and lengths. The client decodes the directory once, then decodes only entries needed by the query.

Enable individual families through `WriteIndexOptions`:

```ts
await writeIndex(built, outDir, {
  termShardFormat: "binary",
  fuzzyShardFormat: "binary",
  docStoreFormat: "binary",
});
```

The format is little-endian and uses explicit bounds checks. Term postings use delta and varint encoding; fuzzy entries support direct deletion-key lookup; document storage supports direct document-ID lookup. Tests compare binary and JSON query behavior and reject truncated or malformed payloads.

JSON remains the default because it is easy for independent producers to emit and native parsing is competitive when the whole object is needed. Binary is justified only for large maps where a query touches few keys. Facets, pins, synonyms, and vectors therefore stay JSON. The original benchmark investigation and draft binary specification are retained under `docs/archive/`.
