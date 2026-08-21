# ADR-0006: Geo facets as a fourth facet-shard type; exact match on stored fields without a facet declaration

## Status

Accepted, implemented in both `packages/searchable` (TypeScript) and `python/searchable` (Python `searchable.indexer`/`searchable.client`).

## Context

Two related, but distinct, filtering gaps existed alongside the terms/range/hierarchy facet system ([guides/facets.md](../guides/facets.md)):

1. No way to filter or rank by geographic proximity — a common requirement for store-locator, event, and listings use cases ("things near me").
2. A facet filter only ever worked on a field the author had separately declared with a `searchable-facet-<field>` (or `-range-`) meta tag, even when the same field was already indexed and stored for display. A caller wanting to filter on, say, a `sku` field already shown in results had to duplicate it as a facet purely to make it filterable.

Both had to preserve this project's existing constraints: a pull-based static JSON index with no query-time backend ([ADR-0001](0001-pull-based-static-http.md)), and identical behavior between the TypeScript and Python clients ([`CLAUDE.md`](../../CLAUDE.md)).

## Decision

**Geo facets**: a fourth `FacetShard.type`, `"geo"`, alongside `"terms"`/`"range"`/`"hierarchy"`. Authors declare one coordinate per document with a `searchable-facet-geo-<field>` meta tag, content `"lat,lon"`. The shard stores an unsorted `points: {lat, lon, doc}[]` array — deliberately not a spatial index (R-tree, geohash grid, etc.): at this project's "small corpus JSON tier" scale ([guides/indexing.md](../guides/indexing.md#what-to-simplify-at-this-scale)), the same tradeoff the range facet's linear sorted-array scan already makes, a full scan against a haversine distance check is negligible and keeps the shard format as simple as every other facet type. `SearchOptions.filters` gains a fourth filter shape, `{lat, lon, radiusKm}` (`{"lat", "lon", "radius_km"}` in Python — see below), detected the same way `RangeFilter` already is: by the field's own facet shard `type`, not by inspecting the filter value's shape in isolation. `Hit.distanceKm`/`Hit.distance_km` and `SearchOptions.sortByDistance`/`sort_by_distance` are populated/honored only when exactly one geo filter is active, since with two or more active geo filters simultaneously there's no single unambiguous distance to report or sort by.

**Exact match on stored fields**: `SearchOptions.filters` resolution already fell back to "ignore this field" for anything with no matching facet shard (a deliberate choice, so a typo'd filter field doesn't hard-fail the whole query). That fallback is extended one step: before giving up, check whether the field is declared `stored: true` in the manifest; if so, fetch doc-store entries for the organic candidate set and match the field's raw stored value exactly (same string/`string[]`-OR shape a terms-facet filter already uses). This requires no new index artifact — doc-store shards already exist for every stored field — only new client-side resolution logic in both `search.ts` and `search.py`. It's scoped to `search()`'s candidate narrowing only, not `facetValues()`/`facet_values()` (which is inherently about *facet* results an undeclared field has none of) and not pin gating (checking a pin's stored-field value would cost an extra doc-store fetch on every query regardless of whether pins matched, for what's already an edge-case fallback).

Both features are additive: no manifest `version` bump, no change to any existing shard shape, and a field with neither a facet declaration nor `stored: true` keeps today's "ignored" filter behavior. `spec/schema/facet-shard.schema.json`'s `type` enum gains `"geo"` and its `points` property, keeping the schema authoritative per [ADR-0002](0002-json-first-index-format.md).

## Alternatives Considered

- **A spatial index (geohash grid, R-tree) for geo facets**: rejected for the initial implementation — real complexity (a new on-disk structure, a new sharding strategy) for a corpus scale where a linear haversine scan is already fast enough, the same reasoning that kept the range facet's sorted-array scan unoptimized. Revisit only with concrete evidence a linear scan is a bottleneck at some deployment's real corpus size, per the roadmap's [performance-evidence discipline](../project/roadmap.md#performance-and-scale-evidence).
- **Geo as a range-style precomputed aggregate (bucketed by distance from a fixed center)**: rejected — a geo query's center point is per-query, not fixed at build time, so there's no single meaningful build-time bucketing the way a range facet's `[min, max]` histogram has.
- **Requiring every filterable field to also be declared as a facet** (status quo, no exact-match fallback): rejected — forces authors to duplicate a field's declaration purely to make it filterable when it's already indexed/stored, with no benefit over falling back to a stored-field equality check the client can already perform cheaply against data it has to fetch for display anyway.
- **Making the exact-match fallback also gate pins and `facetValues()`**: rejected for this iteration — both would require fetching doc-store data outside the already-necessary organic-candidate path (every matched pin regardless of query match, or the whole corpus for a facet-only panel query), a real added cost for what is explicitly a fallback, edge-case path. Revisit only if a concrete consumer needs it.
- **Same key casing (`radiusKm`) for the Python geo filter dict**: rejected — unlike the manifest/shard JSON (which both clients parse and must agree on byte-for-byte field names), a query-time filter dict is never serialized to the shared index format; it's constructed directly in each language's own calling code, so each follows its own naming convention (`radiusKm` in TS, `radius_km` in Python) the same way `sortByDistance`/`sort_by_distance` and `distanceKm`/`distance_km` already do.

## Consequences

- A geo facet field cannot be requested via `SearchOptions.facets`/`facet_values()` — there are no discrete values or precomputed buckets to report, only radius filtering and (optionally) distance.
- Every geo query does a full scan of the field's `points` array; this is fine at documented "small corpus JSON tier" scale but is a real, not yet needed, future optimization target if a deployment's geo shard grows large.
- The exact-match stored-field fallback fetches doc-store data for the entire organic candidate set up front (rather than only the final top-N page, as every other code path does) whenever it's used — an accepted, documented cost specific to this fallback, not a change to the cost of any existing filter path.
- `packages/searchable`'s `Manifest.fields` lookup and Python's `manifest.fields.get(f)` are now both read by the filter-resolution path in addition to the doc-store/scoring paths that already read them — no shape change, just a new caller.
