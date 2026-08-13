# Configuration

This reference collects the supported indexer, writer, client, and offline options without presenting planned settings as current behavior.

## BuildIndexOptions

- `fieldBoosts`
- `synonyms`
- `fuzzy` and `fuzzyMaxEdits`
- `hierarchicalFacets`
- `rangeFacetBuckets`
- `allowedUrlOrigins` and `canonicalBaseUrl`

`buildIndex(sources, defaultLanguage, options)` is synchronous. Source IDs must be stable and unique.

## WriteIndexOptions

- `maxShardGzipBytes` and `shardByPrefix`
- `docStoreShardSize`

## SearchClientOptions

- required `indexUrl`
- `allowCrossOriginShards` and `strict`

For a small site, defaults are appropriate. Internationalization, synonyms, and fuzzy dictionaries should be configured only for languages and features the deployment actually uses.
