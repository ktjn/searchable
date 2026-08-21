# Facets

This guide covers the implemented terms, range, hierarchical, and geo facets, their filters, and contextual counts, plus the exact-match fallback for fields with no declared facet at all.

## Facet types

Authors declare terms values with repeatable `searchable-facet-<field>` meta tags and one numeric range value with `searchable-facet-range-<field>`. Configure hierarchical fields through `BuildIndexOptions.hierarchicalFacets`. A geo field is declared with one `searchable-facet-geo-<field>` meta tag per document, content `"lat,lon"` — see [Geo facets](#geo-facets) below.

## Facet index structure

Terms and hierarchy shards store each value's document IDs and count. Range shards also store sorted numeric values and histogram buckets configured through `BuildIndexOptions.rangeFacetBuckets`. Geo shards store one `(lat, lon, doc)` point per document instead — there are no discrete facet values or aggregate buckets for a geo field, only radius filtering.

## Filtering

Ask for facet results with `SearchOptions.facets` and filter with `SearchOptions.filters`:

```ts
const result = await search.search("headphones", {
  facets: ["category", "price"],
  filters: {
    category: ["electronics", "audio"],
    price: { min: 25, max: 250 },
  },
});
```

Multiple terms values within one field are ORed; filters across fields are ANDed. Range bounds are inclusive and may omit either `min` or `max`. Counts are contextual: while computing one field, the client applies all other active filters but not that field's own selection.

## Facet counts

`search.facetValues(field, options)` supports a filter-only panel before the visitor enters text. Hierarchical results include their configured `separator`, and every ancestor path is present so consumers can rebuild a tree.

## Geo facets

Declare a geo field per document with one meta tag, content `"lat,lon"`:

```html
<meta name="searchable-facet-geo-location" content="51.5074,-0.1278">
```

`lat` must be in `[-90, 90]` and `lon` in `[-180, 180]`; a malformed or out-of-range value is dropped with a build-time warning, the same tolerance the range-facet parser gives a non-numeric value.

Filter with a `{lat, lon, radiusKm}` object instead of a string/string[] or `{min?, max?}` range — `unionDocsForField`/`_union_docs_for_field` detects the shape from the field's own facet shard `type`, same as every other filter shape. The Python dict uses snake_case `radius_km` (this filter object is a pure in-language query parameter, never serialized to the shared index format, so each client follows its own naming convention):

```ts
const result = await search.search("coffee", {
  filters: { location: { lat: 51.5, lon: -0.12, radiusKm: 5 } },
});
```

```python
result = search("coffee", manifest, cache, base_url, SearchOptions(
    filters={"location": {"lat": 51.5, "lon": -0.12, "radius_km": 5}},
))
```

Distance is computed with the haversine great-circle formula (mean Earth radius 6371 km) — accurate enough for radius filtering at this project's small-corpus JSON scale, not survey-grade geodesy. There's no spatial index; a query scans every point in the field's shard, the same "negligible at this scale, revisit if it matters" tradeoff the range facet's sorted-array scan makes.

`Hit.distanceKm` (`Hit.distance_km` in Python) is populated whenever exactly one geo filter is active — with two or more active geo filters simultaneously, which one a hit's distance should be measured against is ambiguous, so neither is reported. Set `SearchOptions.sortByDistance`/`sort_by_distance` to rank organic hits by ascending distance instead of BM25F score under that same single-active-filter condition; pinned hits are unaffected, since pins already lead every result regardless of ranking mode (docs/guides/pinning.md).

A geo field has no discrete facet values, so it can't be requested via `SearchOptions.facets`/`facet_values()` — only filtering and distance are supported.

## Exact match on stored fields

A facet filter normally only works on a field with a declared facet shard (`searchable-facet-<field>`/`searchable-facet-range-<field>`/`searchable-facet-geo-<field>`). A filter targeting a field with *no* facet shard, but declared `stored: true` in the manifest (any indexed-and-stored or stored-only field), instead falls back to exact string-equality matching against that field's raw doc-store value — the author doesn't need to also emit a facet meta tag just to make a field filterable:

```ts
const result = await search.search("widget", {
  filters: { sku: "ABC-123" }, // no searchable-facet-sku meta tag needed
});
```

The filter shape is identical to a terms-facet filter: a string or `string[]` (OR across values within the field, AND across different fields). This fallback only applies to `SearchOptions.filters` in `search()` — it narrows the organic candidate set, so it requires a free-text query to have already produced candidates, and it does not apply to `facetValues()`/`facet_values()`, which is inherently about *facet* results that an undeclared field has none of. It also doesn't gate pins the way an active facet filter does (docs/guides/pinning.md#authoring): checking a pin's stored-field value would require an extra doc-store fetch for every matched pin on every query regardless of whether pins matched the organic query, an unnecessary cost for what's already an edge-case fallback path. A field matching neither a facet shard nor a stored field is ignored, same as an unknown filter field always has been.
