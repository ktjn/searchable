# Faceted Search

**Status**: Terms facets are built — extraction (`csf-facet-<field>`,
[15-cms-meta-tag-control.md](15-cms-meta-tag-control.md)), the shard
format below, filtering (single/multi-select, AND-across-fields), and
contextual counts (excluding a facet's own active filter, per
["Facet counts"](#facet-counts-how-many-results-if-i-also-select-x)
below) all have working code and real tests in
[`packages/indexer`](../packages/indexer)/[`packages/client`](../packages/client) —
see [09-roadmap.md](09-roadmap.md#status). Range and hierarchical
facets, and a `facetValues()`/filter-only browsing call with no free-text
query, remain design-only for now.

## Facet types

| Type | Example | Storage |
|---|---|---|
| Terms (categorical) | `category: "electronics"`, `tags: ["sale","new"]` | value → doc-id set + count |
| Range (numeric) | `price: 0-50, 50-100, 100+` | precomputed buckets + sorted raw values |
| Date/range | `publishedAt` by year/month | same as numeric range, bucketed by calendar unit |
| Hierarchical | `category > subcategory > leaf` | path-aware terms facet, see below |
| Boolean | `inStock: true/false` | degenerate terms facet with 2 values |

All facet fields are declared in the manifest
(`facetFields`, [02-index-format.md](02-index-format.md#manifest)) and
each gets its own shard so a page that never opens the facet panel
doesn't pay to fetch facet data at all.

## Facet index structure

```jsonc
// facets/category.9c02.json
{
  "type": "hierarchy",
  "separator": ">",
  "values": {
    "electronics": { "count": 900, "docs": [/*...*/] },
    "electronics>audio": { "count": 340, "docs": [/*...*/] },
    "electronics>audio>headphones": { "count": 120, "docs": [/*...*/] }
  }
}
```

Hierarchical facets store each level as its own addressable terms entry
(full path as the key) so counting and filtering at any depth is a
direct lookup, not a runtime tree-walk; the UI reconstructs the tree
shape client-side from the `separator`-delimited keys.

Range facets store both precomputed buckets (fast common case: "0-50",
"50-100"...) and a sorted array of raw `(value, docId)` pairs (binary
tier: delta-encoded) so an arbitrary user-entered min/max slider filter
can binary-search the sorted array rather than being limited to the
bucket boundaries chosen at build time.

## Filtering

Facet filters are applied as **doc-id set intersection**, independent of
and prior to relevance scoring (they don't affect BM25 scores — see
[04-query-ranking-boosts.md](04-query-ranking-boosts.md#combining-with-filtersfacets)).

- **Single-select** facet: simple intersection with the chosen value's
  doc set.
- **Multi-select within one facet** (e.g. tags: "sale" OR "new"): union
  of the selected values' doc sets, then intersected with the rest of
  the query's candidate set — standard "OR within a facet, AND across
  facets" semantics that match user expectation (matches
  Algolia/Typesense/ES aggregation UX conventions).
- **Range filter**: binary-search range on the sorted values array (or
  union of overlapping precomputed buckets, whichever the query
  resolves to faster given what's already been fetched).

## Facet counts ("how many results if I also select X")

Two modes, selectable per facet (tradeoff is fetch cost vs. UX
correctness):

1. **Global counts** (cheapest): the raw `count` stored in the facet
   shard, computed once at build time over the whole corpus — ignores
   the user's current query/filters. Fine for facets that rarely
   interact with search terms (e.g. a static "brand" list on a page with
   no free-text query).
2. **Contextual counts** (default when a free-text query or other
   filters are active): computed client-side at query time by
   intersecting each candidate facet value's doc-id set with the
   *current* result candidate set — this is the "12 results if you also
   filter to 'in stock'" behavior users expect from modern faceted UIs.
   Since the current candidate set is already resident in the Worker
   (it's exactly the scored/filtered doc-id set from the query in
   flight), this is cheap: an intersection against already-fetched facet
   shards, no additional network round trip beyond fetching the facet
   shards for whichever facets are currently rendered.

## Facet shard fetch strategy

Facet panels are typically rendered up front (before the user types
anything), so:
- Facet shards for **top-level facets that will be visible immediately**
  can be prefetched alongside the manifest (configurable "prefetch"
  list) so the facet UI isn't empty on first paint.
  the search box, since they scope to *this* query.
- Deep hierarchical levels are fetched lazily (only when a user expands
  a branch) rather than the whole tree up front, to keep facet shard size
  independent of taxonomy depth/breadth.

## Interaction with faceting UI patterns

The engine returns, per query:

```ts
interface SearchResult {
  hits: Hit[];
  totalHits: number;
  facets: Record<string, FacetResult>; // only for facets the caller asked to include
  tookMs: number;
}

interface FacetResult {
  values: { value: string; count: number; selected: boolean }[];
  otherCount?: number; // sum of unshown long-tail values, for "show more"
}
```

This is deliberately similar in shape to established faceted-search
client conventions (Algolia/Typesense/Elasticsearch aggregations) so
existing facet UI component libraries/patterns port over with minimal
adaptation.
