# Configuration

This reference collects the supported indexer, writer, client, and offline options without presenting planned settings as current behavior.

## BuildIndexOptions

- `fieldBoosts`
- `synonyms`
- `fuzzy` and `fuzzyMaxEdits`
- `hierarchicalFacets`
- `rangeFacetBuckets`
- `allowedUrlOrigins` and `canonicalBaseUrl`

`buildIndex(sources, defaultLanguage, options)` is synchronous. Source IDs must be stable and unique. Vector building is separate because embedding can be asynchronous.

## WriteIndexOptions

- `maxShardGzipBytes` and `shardByPrefix`
- `termShardFormat`, `fuzzyShardFormat`, and `docStoreFormat`
- `docStoreShardSize`
- `vectors`

All three format options default to `"json"`; prefix sharding defaults on. `vectors` is the `BuiltVectors` value returned by `buildVectorShards`.

## SearchClientOptions

- required `indexUrl`
- `worker` and `workerUrl`
- `allowCrossOriginShards` and `strict`
- `embedQuery` and `validateVectorProvider`

## Query and offline options

Search configuration is per call through `SearchOptions`; see [Client API](client-api.md). `registerOfflineCaching(swUrl, indexUrl, options)` accepts `mode: "cache-first" | "stale-while-revalidate"`, optional `languages`, `allowCrossOriginShards`, and `scope`. Both `swUrl` and `indexUrl` may be relative or absolute; see the [offline search guide](../guides/offline-search.md) for scope and `Service-Worker-Allowed` behavior.

For a small site, defaults are appropriate. Larger corpora can lower `maxShardGzipBytes`, set `docStoreShardSize`, or opt hot shard families into binary after measuring. Internationalization, synonyms, fuzzy dictionaries, and vectors should be configured only for languages and features the deployment actually uses.
