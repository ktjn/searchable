# Facets

This guide covers the implemented terms, range, and hierarchical facets, their filters, and contextual counts.

## Facet types

Authors declare terms values with repeatable `csf-facet-<field>` meta tags and one numeric range value with `csf-facet-range-<field>`. Configure hierarchical fields through `BuildIndexOptions.hierarchicalFacets`.

## Facet index structure

Terms and hierarchy shards store each value's document IDs and count. Range shards also store sorted numeric values and histogram buckets configured through `BuildIndexOptions.rangeFacetBuckets`.

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
