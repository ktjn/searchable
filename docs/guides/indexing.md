# Indexing content

This guide turns rendered HTML into the static manifest and shards consumed by `SearchClient`.

The `searchable` Python package contains the index generator. It discovers HTML
files, extracts searchable documents, builds the in-memory index, and writes
content-hashed files. Run it with its default options via the consolidated CLI:

```bash
uv run --project python/searchable searchable build ./dist/site ./dist/site/search-index
```

After installing the PyPI package, the equivalent command is simply
`searchable build <input_dir> <out_dir>`. The previous positional form without
the `build` subcommand remains available for compatibility.

For build/write options beyond the CLI's defaults (field boosts, facets,
synonyms, fuzzy matching, and shard sizing), drive `build_index` and
`write_index` directly — either from your own Python script or through the
repository's `scripts/build_from_config.py`, which reads a source list and a
JSON config of build/write keyword arguments:

```bash
uv run --project python/searchable python python/searchable/scripts/build_from_config.py sources.json config.json ./dist/site/search-index
```

See [Configuration](../reference/configuration.md) for the available
`build_index` and `write_index` options.

## What to simplify at this scale

For a corpus of roughly 2,000 documents, the JSON defaults are appropriate. `shard_by_prefix=False` can reduce request count for a deliberately small index.

By default, `write_index` splits terms by prefix and recursively splits oversized buckets against `DEFAULT_MAX_TERM_SHARD_GZIP_BYTES`.

Publish the entire output directory without rewriting filenames. Serve `manifest.json` with short cache lifetime or revalidation, and content-hashed shard files with long-lived immutable caching. For extraction controls, see [CMS meta tags](../reference/cms-meta-tags.md); for build options, see [Configuration](../reference/configuration.md).
