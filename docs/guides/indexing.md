# Indexing content

This guide turns rendered HTML into the static manifest and shards consumed by `SearchClient`.

The Python `searchable-indexer` (`python/searchable-indexer`) is the index generator: it discovers HTML files, extracts searchable documents, builds the in-memory index, and writes content-hashed files. Run it with its default options via the CLI:

```bash
uv run --project python/searchable-indexer searchable-indexer ./dist/site ./dist/site/search-index
```

That command refers to this repository project. Release artifacts for
`searchable-indexer` are published to PyPI.

For build/write options beyond the CLI's defaults (field boosts, facets, synonyms, fuzzy matching, shard formats, and so on), drive `build_index`/`write_index` directly — either from your own Python script or via the repository's `scripts/build_from_config.py`, which reads a source list and a JSON config of `build`/`write` keyword arguments:

```bash
uv run --project python/searchable-indexer python python/searchable-indexer/scripts/build_from_config.py sources.json config.json ./dist/site/search-index
```

See [Configuration](../reference/configuration.md) for the available `build_index`/`write_index` options.

## What to simplify at this scale

For a corpus of roughly 2,000 documents, keep the JSON defaults unless measurements show a problem. `shard_by_prefix=False` can reduce request count for a deliberately small index.

By default, `write_index` splits terms by prefix and recursively splits oversized buckets against `DEFAULT_MAX_TERM_SHARD_GZIP_BYTES`. `term_shard_format`, `fuzzy_shard_format`, and `doc_store_format` opt individual shard families into their binary codecs; the other shard families remain JSON.

Publish the entire output directory without rewriting filenames. Serve `manifest.json` with short cache lifetime or revalidation, and content-hashed shard files with long-lived immutable caching. For extraction controls, see [CMS meta tags](../reference/cms-meta-tags.md); for build options, see [Configuration](../reference/configuration.md).
