# Index format

This page defines the implemented JSON-first manifest and shard contract that independent index producers and browser clients share.

## Manifest

`manifest.json` has `version: 2`, a content-derived `buildId`, languages and a default language, field configuration, per-language BM25 statistics, and references to physical shards. Optional sections advertise facets, pins, synonyms, and fuzzy dictionaries. The authoritative machine-readable shapes are in [`spec/schema/`](../../spec/schema/).

Typical output:

```text
manifest.json
terms/<language>/<prefix>.<hash>.json
docs/<shard>.<hash>.json
facets/<field>.<hash>.json
pins/<language>.<hash>.json
synonyms/<language>.<hash>.json
fuzzy/<language>.<hash>.json
```

## Term shard (inverted index)

Term postings contain document IDs, per-field frequency and positions, field length, and an optional document boost. Document-store entries contain the URL, stored display fields, and the boost for inspection. Facet shards contain document sets and aggregate data; pin, synonym, and fuzzy shapes match their exported `@ktjn/searchable-format` types.

## Doc store

Document-store entries contain the result URL and stored fields. Physical shards cover contiguous document-ID ranges so the client fetches only ranges containing final hits.

### Doc store shard

Each manifest doc-store entry records its shard number, file, and ID range.

## Versioning and cache strategy

All output is deterministic and shard filenames are content hashed. Clients must resolve filenames relative to the manifest, validate `version` before use, reject unsafe shard origins by default, and treat referenced files as immutable. See [Compatibility](../reference/compatibility.md).

## Size targets and sharding tuning

Term buckets default to a 50 KiB gzipped target and widen their prefix recursively when oversized. `maxShardGzipBytes`, `shardByPrefix`, and `docStoreShardSize` provide explicit deployment tuning.
