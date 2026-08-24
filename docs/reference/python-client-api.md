# Python client API

This reference lists the implemented `searchable` Python surface. It is an
independent synchronous client that reads the same manifest and shards as
`@ktjn/searchable`.

## SearchClient

```python
from searchable import FacetValuesOptions, SearchClient, SearchOptions

client = SearchClient(
    index_url,
    allow_cross_origin_shards=False,
    strict=False,
)
result = client.search(query, SearchOptions(highlight=True))
facet = client.facet_values(field, FacetValuesOptions())
documents = client.get_documents([42, 43])
```

`SearchClient` validates the manifest during construction. Relative paths and
`file:` URLs are resolved to an absolute URL first. Unsupported manifests and
disallowed cross-origin shard references raise `InvalidManifestError`.

## Search options and results

`SearchOptions` contains:

- `language`, `limit`, and `operator` (`"and"` or `"or"`)
- `boosts` with optional `"fields"` and `"terms"` maps
- `filters` and `facets`
- `synonyms` and `synonym_weight`
- `fuzzy` and `fuzzy_weight`
- `highlight`
- `sort_by_distance` ([Geo facets](../guides/facets.md#geo-facets))

There is no `signal`; the synchronous Python client has no cancellation API.

Filter values are a `str` or `list[str]`, a `{"min": ..., "max": ...}`
range dict, or a `{"lat": ..., "lon": ..., "radius_km": ...}` geo dict.
The geo query parameter uses Python's snake_case convention and is never
serialized into the shared index format.

`SearchResult` contains `hits`, `total_hits`, and `language`, plus requested
`facets` and optional `did_you_mean`. Every `Hit` has `id`, `score`, `url`, and
stored `fields`; structured indexes may also provide `external_id`,
`metadata`, and `content_hash`. A hit can additionally contain `pinned`,
`highlights`, and `distance_km`.

## Structured document retrieval

`get_documents(ids)` loads stored documents by internal integer ID and returns
them in the requested order, omitting IDs that are not present. Retrieved hits
have a score of `0.0` and no highlights. `retrieve(ids)` is a deprecated
compatibility alias; new code should use `get_documents(ids)`.

## Streaming results

`search_stream(query, options)` is a generator. When synonym or fuzzy
expansion is enabled, it yields a literal/prefix partial result followed by
the expanded result. Otherwise it yields one final result.

## Facet-only queries

`facet_values(field, options)` accepts filters through `FacetValuesOptions`
and returns a `FacetResult` with values and an optional hierarchy separator.

## CLI

The installed console script exposes the consolidated toolkit:

```bash
searchable build <input_dir> <out_dir> \
  [--sections h2,h3] [--page-and-sections]

searchable query <index_url> <query> \
  [--limit N] [--language LANG] [--filter FIELD=VALUE ...] \
  [--facets field1,field2] [--synonyms] [--fuzzy] [--highlight] [--json]

searchable facet <index_url> <field> \
  [--filter FIELD=VALUE ...] [--json]
```

For compatibility, `searchable <input_dir> <out_dir>` remains an alias for
`searchable build <input_dir> <out_dir>`. The module entry point
`python -m searchable` exposes the same commands.

`--filter` may be repeated. `--json` emits camel-cased JSON compatible with
the TypeScript result shape; without it, query and facet commands print a
short human-readable summary.

## Differences from `@ktjn/searchable`

- Python runs synchronously in the host process rather than in a browser.
- Python has no `AbortSignal` or disposal lifecycle.
- Python alone exposes `search_stream()` and structured `get_documents()`.
