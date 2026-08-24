# Client API

This reference lists the implemented `@ktjn/searchable` 2.x surface. The
type declarations shipped with the package are the normative API.

## SearchClient

```ts
import { SearchClient } from "@ktjn/searchable";

const client = new SearchClient({ indexUrl: "/search-index/manifest.json" });
await client.ready();
const result = await client.search(query, searchOptions);
const facet = await client.facetValues(field, facetOptions);
client.dispose();
```

`SearchClientOptions` contains:

- required `indexUrl`
- `allowCrossOriginShards`, off by default
- `strict`, an opt-in set of additional semantic manifest checks

`ready()` resolves after the manifest has loaded and passed validation.
`dispose()` is idempotent, rejects pending work, and prevents future use.

## Search options and results

`SearchOptions` contains:

- `language`, `limit`, and `operator` (`"and"` or `"or"`)
- `boosts.fields` and `boosts.terms`
- `filters` and `facets`
- `synonyms` and `synonymWeight`
- `fuzzy` and `fuzzyWeight`
- `highlight` and `signal`
- `sortByDistance` ([Geo facets](../guides/facets.md#geo-facets))

`filters` values are a `string` or `string[]` for terms and exact-match
filters, a `{min?, max?}` `RangeFilter`, or a `{lat, lon, radiusKm}`
`GeoFilter`. See [Facets](../guides/facets.md) for their behavior.

`SearchResult` contains `hits`, `totalHits`, and `language`, plus requested
`facets` and optional `didYouMean`. Every `Hit` has `id`, `score`, `url`, and
stored `fields`. A hit may also include `pinned`, `highlights`, structured
document fields, and `distanceKm` when exactly one geo filter is active.

## Facet-only queries

`facetValues(field, options)` accepts `filters` and `signal` through
`FacetValuesOptions`. It returns a `FacetResult` with `values` and an optional
hierarchy `separator`.

## Abort and lifecycle semantics

`SearchOptions.signal` and `FacetValuesOptions.signal` reject that caller's
operation with an `AbortError` as soon as the signal fires, including while
the client is initializing. Cancellation stops waiting; shared manifest and
shard fetches may continue and populate the client's cache for other callers.

Disposal is client-wide rather than caller-specific. It rejects `ready()`,
`search()`, and `facetValues()` operations that are already waiting and makes
future calls fail immediately.

## Other exports

The package exports `SearchClient`, `SearchClientOptions`, the search/result,
facet, highlight, range, and geo types, `InvalidManifestError`, and
`isRtlLanguage`. Manifest validation itself remains an internal implementation
detail.
