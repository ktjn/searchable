# Configuration

This reference collects the implemented index-builder, writer, and client
settings. Python APIs use snake_case; the JSON-driven repository helper maps
camelCase JSON keys onto these names.

## `build_index`

`build_index(sources, default_language="en", ...)` accepts:

- `field_boosts`
- `allowed_url_origins` and `canonical_base_url`
- `hierarchical_facets`
- `range_facet_buckets`
- `synonyms`
- `fuzzy` and `fuzzy_max_edits`
- `section_indexing`

For structured input, `build_index_documents()` requires explicit
`field_definitions` and accepts synonym and fuzzy settings.

## `write_index`

`write_index(built, out_dir, ...)` accepts:

- `max_shard_gzip_bytes`
- `shard_by_prefix`
- `doc_store_shard_size`

Output is always JSON in manifest version 2.

## Search clients

The TypeScript `SearchClient` accepts required `indexUrl` plus optional
`allowCrossOriginShards` and `strict`. Python exposes the equivalent
`index_url`, `allow_cross_origin_shards`, and `strict` arguments.

Defaults suit small sites. Enable synonyms, fuzzy dictionaries, additional
languages, or finer sharding only when the deployment uses them.
