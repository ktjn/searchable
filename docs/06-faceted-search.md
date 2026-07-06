# Faceted Search

**Status**: Terms facets are built — extraction (`csf-facet-<field>`,
[15-cms-meta-tag-control.md](15-cms-meta-tag-control.md)), the shard
format below, filtering (single/multi-select, AND-across-fields), and
contextual counts (excluding a facet's own active filter, per
["Facet counts"](#facet-counts-how-many-results-if-i-also-select-x)
below) all have working code and real tests in
[`packages/indexer`](../packages/indexer)/[`packages/client`](../packages/client) —
see [09-roadmap.md](09-roadmap.md#status). Range facets are now fully
built, both halves: **filtering** (`csf-facet-range-<field>`
extraction, a shard storing every `(value, doc)` pair sorted ascending
— `FacetShard.sorted` — and `search(query, {filters: {field: {min?,
max?}}})` resolving an arbitrary min/max via a scan of that sorted
array) and **aggregate results** (`packages/indexer/src/build-index.ts`'s
`computeRangeFacetBuckets()` computes 5 equal-width buckets over the
corpus's observed `[min, max]` after every document is processed,
populating `FacetShard.values` with the exact same `{count, docs}`
shape terms facets use, keyed by a human-readable label like `"10-20"`
or `"80+"` for the open-ended last bucket — deliberately reusing that
shape meant `search()`/`facetValues()` needed *zero* client-side
changes to surface them, since their contextual-count aggregation
already iterates `shard.values` generically regardless of facet type).
Not built yet: precomputed-bucket-based filtering (the sorted-array
scan used for filtering is correct today, just not the fastest possible
at very large shard sizes) and author-configurable bucket
count/boundaries (5 equal-width buckets is a fixed default, not yet
tunable). A `facetValues()` filter-only browsing call with no
free-text query is also built (docs/07-client-api.md#facet-only-queries) —
same contextual-count convention as `search()`'s `facets` option, and
now the same aggregate-bucket results for a range field too.
Hierarchical facets are now built too: a build-time option,
`buildIndex(sources, lang, { hierarchicalFacets: { category: {
separator?: ">" } } })`, marks a `csf-facet-<field>` field as
path-structured — each authored value (e.g.
`"electronics>audio>headphones"`) is split on that field's separator
and every ancestor prefix is indexed as its own addressable entry
(`"electronics"`, `"electronics>audio"`,
`"electronics>audio>headphones"`), reusing the exact same `{count,
docs}` shape terms facets use (see "Facet index structure" below) — the
same "zero client-side changes to surface it" design already used for
range aggregate results, since `search()`/`facetValues()` already
iterate `shard.values` generically. The one genuinely new client-side
surface is `FacetResult.separator`, populated only for a
hierarchy-type field, so a consumer can split a path into its segments
without hardcoding a delimiter. A doc that declares two sibling paths
sharing an ancestor (e.g. `"electronics>audio>headphones"` and
`"electronics>video>tv"` on the same page) is still counted only once
at that shared ancestor, not once per sibling. Which field is
hierarchical is a corpus-wide build decision (like field boosts or
synonyms), not a per-page `csf-*` meta tag — a page still authors a
plain string value, it's `buildIndex()`'s options that decide how to
interpret it. Not built yet: reconstructing/rendering the tree shape
itself is left to the consuming UI (splitting each returned `value` on
`separator`), and there's no author-configurable minimum/maximum depth
or lazy per-branch shard splitting yet — every level lives in one
shard, same as an ordinary terms facet.

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
bucket boundaries chosen at build time. **Built today**: the sorted
array (`FacetShard.sorted`, JSON tier, no delta-encoding), resolved via
a linear scan rather than binary search for *filtering* (correct either
way, since the array is sorted; negligible cost difference at "small
corpus" JSON-tier scale — see
[14-reference-deployment-cms-2k.md](14-reference-deployment-cms-2k.md#what-to-simplify-at-this-scale)),
plus precomputed buckets in `values` for *aggregate results* — 5
equal-width buckets spanning the corpus's observed `[min, max]`,
computed once after every document is processed
(`computeRangeFacetBuckets()` in
[`packages/indexer/src/build-index.ts`](../packages/indexer/src/build-index.ts)).
A single distinct value across the whole corpus collapses to one
bucket labeled with that value, rather than 5 degenerate zero-width
ones. Still design-only: author-configurable bucket count/boundaries
(the bucket count is a fixed constant, `RANGE_FACET_BUCKET_COUNT`, not
a build option yet) and the binary tier's delta-encoding.

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
- **Range filter**: `{min?, max?}` inclusive bounds
  (`packages/client/src/search.ts`'s `RangeFilter`), resolved today as
  a linear scan over the sorted values array (a binary-search-narrowed
  scan, and a union-of-overlapping-precomputed-buckets fast path, are
  documented future optimizations once shard size makes the difference
  measurable — see the "Facet index structure" status note above).

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
- Deep hierarchical levels fetched lazily (only when a user expands a
  branch) rather than the whole tree up front, to keep facet shard size
  independent of taxonomy depth/breadth, is still design-only — today's
  hierarchical facet shard holds every level in one file, same as an
  ordinary terms facet (see "Facet types" above); a taxonomy deep/wide
  enough to make that worth splitting is a real but so-far-unencountered
  scale problem, not something the current reference deployment
  ([14-reference-deployment-cms-2k.md](14-reference-deployment-cms-2k.md))
  needs.

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
