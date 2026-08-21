# Python client API

This reference lists the implemented `searchable` (Python) surface — a
second, independent client implementation for CLI and backend-service use
that reads the same manifest/shard contract as `@ktjn/searchable`. The
package lives at `python/searchable/` and is published to PyPI from
`v*` release tags.

## SearchClient

```python
from searchable import SearchClient
from searchable.search import SearchOptions, FacetValuesOptions

client = SearchClient(
    index_url,
    allow_cross_origin_shards=False,
    strict=False,
)
result = client.search(query, options)
for partial in client.search_stream(query, options):
    ...
facet = client.facet_values(field, facet_options)
documents = client.get_documents([42, 43])
```

`SearchClient(index_url, *, allow_cross_origin_shards=False, strict=False)`
validates the manifest at construction time (relative paths and `file:` URLs
are resolved to an absolute URL first) and raises on an unsupported manifest
version or shard origin. The client always runs synchronously in the calling
process.

## Search options and results

`SearchOptions` contains:

- `language`, `limit`
- `mode`: `"lexical"`
- `boosts` (a dict with `"fields"` and/or `"terms"` keys)
- `filters` and `facets`
- `synonyms` / `synonym_weight`
- `fuzzy` / `fuzzy_weight`
- `highlight`
- `sort_by_distance` (docs/guides/facets.md#geo-facets)

There is no `signal` — there is no cancellation support.

`filters` values are a `str`/`list[str]` (terms facet, or a fallback exact
match against a stored-but-unfaceted field,
docs/guides/facets.md#exact-match-on-stored-fields), a `{"min": ..., "max":
...}` range dict, or a `{"lat": ..., "lon": ..., "radius_km": ...}` geo dict
(docs/guides/facets.md#geo-facets) — note the Python dict uses snake_case
`radius_km` where the TS `GeoFilter` uses `radiusKm`, since this dict is a
pure in-language query parameter that's never serialized to the shared index
format, so each client follows its own naming convention.

`SearchResult` contains `hits`, `total_hits`, and `language`, plus requested
`facets` and optional `did_you_mean`. Every `Hit` has `id`, `score`, `url`,
and stored `fields`; structured indexes may additionally provide
`external_id`, `metadata`, and `content_hash`. A hit may also include
`pinned`, `highlights`, and `distance_km` (only when exactly one geo filter
is active).

## Structured document retrieval

`SearchClient.get_documents(ids)` loads stored documents by their internal integer
IDs and returns them in the requested order. IDs that are not present are
omitted. Retrieval is useful for structured/pre-chunked indexes where the
`external_id`, JSON `metadata`, and `content_hash` need to accompany the
stored fields. Retrieved hits have a score of `0.0` and no highlights.

Indexes produced before structured document support remain compatible; their
structured fields are `None`.

`SearchClient.retrieve(ids)` remains as a deprecated compatibility alias until
the first public release.

## Streaming/incremental results

`search_stream(query, options)` is a generator, not a callback-based API: it
yields one or more `SearchResult` values as they become available and
returns when the final result has been yielded. When `synonyms` or `fuzzy`
expansion is requested, it first yields a literal/prefix-only partial result
and then yields the final expanded result; otherwise it yields a single
final result. There is no `AbortSignal` equivalent — closing the generator
(e.g. breaking out of the consuming loop) simply stops iteration.

## Facet-only queries

`facet_values(field, options)` accepts `filters` through `FacetValuesOptions`
and returns a `FacetResult` with `values` (a list of `FacetResultValue`, each
with `value`, `count`, and `selected`) and an optional `separator` for
hierarchical facets.

## CLI

The `searchable` console script installs only the indexer
(`searchable <inputDir> <outDir>`; see
[Indexing content](../guides/indexing.md)). Querying and facets from the
command line are not exposed as a console script — invoke the client CLI
module directly instead:

```bash
python -m searchable.client.cli query <index_url> <query> \
  [--limit N] [--language LANG] [--filter FIELD=VALUE ...] \
  [--facets field1,field2] [--synonyms] [--fuzzy] [--highlight] [--json]

python -m searchable.client.cli facet <index_url> <field> \
  [--filter FIELD=VALUE ...] [--json]
```

`--filter` may be repeated to apply multiple field filters. `--facets` takes
a comma-separated list of facet fields to compute alongside the search.
`--json` prints the full result as JSON (fields camelCased to match the
TypeScript client's wire shape); otherwise the CLI prints a short
human-readable summary.

## Differences from `@ktjn/searchable`

- No browser execution — the Python client only runs directly, synchronously, in the host process.
- No `AbortSignal`/cancellation support.
- No `on()` lifecycle events — there is no query/result event API to subscribe to.
- `search_stream()` is a Python generator (`Iterator[SearchResult]`) that the caller iterates, rather than a callback (`onPartial`) passed into the options.
