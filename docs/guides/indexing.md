# Indexing content

This guide turns rendered HTML into the static manifest and shards consumed by `SearchClient`.

The TypeScript path discovers HTML files, extracts searchable documents, builds the in-memory index, and writes content-hashed files:

```ts
import {
  buildIndex,
  discoverHtmlDocuments,
  writeIndex,
} from "@ktjn/searchable-indexer";

const sources = await discoverHtmlDocuments("./dist/site");
const built = buildIndex(sources);
await writeIndex(built, "./dist/site/search-index");
```

Use the checked-out Python reference implementation explicitly when validating another producer or integrating a Python build pipeline:

```bash
uv run --project python/searchable-indexer searchable-indexer ./dist/site ./dist/site/search-index
```

That command refers to this repository project; it does not imply that `searchable-indexer` is published to PyPI.

## What to simplify at this scale

For a corpus of roughly 2,000 documents, keep the JSON defaults unless measurements show a problem. `shardByPrefix: false` can reduce request count for a deliberately small index.

By default, `writeIndex` splits terms by prefix and recursively splits oversized buckets against `DEFAULT_MAX_TERM_SHARD_GZIP_BYTES`. `termShardFormat`, `fuzzyShardFormat`, and `docStoreFormat` opt individual shard families into their binary codecs; the other shard families remain JSON.

Publish the entire output directory without rewriting filenames. Serve `manifest.json` with short cache lifetime or revalidation, and content-hashed shard files with long-lived immutable caching. For extraction controls, see [CMS meta tags](../reference/cms-meta-tags.md); for build options, see [Configuration](../reference/configuration.md).
