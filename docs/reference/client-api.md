# Client API

This reference lists the implemented `@ktjn/searchable` surface and the exact option names for the `2.0.0` package published to GitHub Packages.

## SearchClient

```ts
const client = new SearchClient(options);
const result = await client.search(query, searchOptions);
const final = await client.searchStream(query, streamOptions);
const facet = await client.facetValues(field, facetOptions);
const unsubscribe = client.on("result", ({ result }) => {});
client.dispose();
```

`SearchClientOptions` contains `indexUrl`, `allowCrossOriginShards`, and `strict`. `indexUrl` is required.

## Search options and results

`SearchOptions` contains:

- `language`, `limit`, and `boosts.fields` / `boosts.terms`
- `filters` and `facets`
- `synonyms` / `synonymWeight`
- `fuzzy` / `fuzzyWeight`
- `highlight` and `signal`
- `sortByDistance` (docs/guides/facets.md#geo-facets)
- `mode: "lexical"`

`filters` values are a `string`/`string[]` (terms facet, or a fallback exact match against a stored-but-unfaceted field, docs/guides/facets.md#exact-match-on-stored-fields), a `{min?, max?}` `RangeFilter`, or a `{lat, lon, radiusKm}` `GeoFilter` (docs/guides/facets.md#geo-facets).

`SearchResult` contains `hits`, `totalHits`, and `language`, plus requested `facets` and optional `didYouMean`. Every `Hit` has `id`, `score`, `url`, and stored `fields`; it may include `pinned`, `highlights`, and `distanceKm` (only when exactly one geo filter is active).

## Streaming/incremental results

`SearchStreamOptions` adds `onPartial`. A partial literal/prefix result is emitted only when synonym or fuzzy expansion requires a later final pass. `AbortSignal` cancels waiting for a caller without invalidating a shared cached fetch.

## Facet-only queries

`facetValues(field, options)` accepts `filters` and `signal` through `FacetValuesOptions` and returns a `FacetResult`.

## Events and lifecycle

`on("query", listener)` and `on("result", listener)` return unsubscribe functions. Events are local observation hooks; the library sends no analytics. `dispose()` is idempotent, rejects pending work, and prevents future use.

Both event payloads carry an *isolated mutable snapshot* of the search options: the `query` event fires with a copy (including copied nested filter arrays and range objects, boost maps, and the facet list), so a listener can read or mutate what it receives without changing the query that executes or what the later `result` event reports. The `result` event always reports the options the query actually ran with.

### Abort semantics

`SearchOptions.signal` rejects the caller's `search()`/`searchStream()`/`facetValues()` promise with an `AbortError` as soon as it fires — including while the client is still initializing (the direct-mode manifest load). Cancelling *waits*, never the shared work itself: shared shard fetches and the shared init keep running for other callers, and nothing is delivered (no `result` event, no `onPartial`) to a caller who already aborted.

## Other exports

The package exports highlighting types, manifest validation (`validateManifest`, `InvalidManifestError`), and RTL detection. The complete type declarations shipped with the package are the normative API. Designs for warm-up, suggestions, federation, and broader diagnostics are archived and linked from the [roadmap](../project/roadmap.md).
