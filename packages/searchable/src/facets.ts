import type { ShardCache } from "./fetch-json.js";
import type { FacetShard, Manifest } from "./format/index.js";
import type { RangeFilter } from "./search.js";
import { resolve } from "./url.js";

function isRangeFilter(value: unknown): value is RangeFilter {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    ("min" in value || "max" in value)
  );
}

export function valuesFor(
  filters: Record<string, string | string[] | RangeFilter> | undefined,
  field: string,
): string[] {
  const raw = filters?.[field];
  if (raw === undefined || isRangeFilter(raw)) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function rangeFilterFor(
  filters: Record<string, string | string[] | RangeFilter> | undefined,
  field: string,
): RangeFilter | undefined {
  const raw = filters?.[field];
  return isRangeFilter(raw) ? raw : undefined;
}

/** Fetches every facet shard in `fields` that actually exists in the manifest, keyed by field name. Shared by search() and facetValues() so they resolve facet shards identically. */
export async function fetchFacetShards(
  manifest: Manifest,
  cache: ShardCache,
  baseUrl: string,
  fields: string[],
): Promise<Map<string, FacetShard>> {
  const entries = (manifest.shards.facets ?? []).filter((s) =>
    fields.includes(s.field),
  );
  const fetched = await Promise.all(
    entries.map(
      async (entry) =>
        [
          entry.field,
          await cache.fetchJson<FacetShard>(resolve(baseUrl, entry.file)),
        ] as const,
    ),
  );
  return new Map(fetched);
}

/**
 * Every doc id matching the active filter on `field` (terms: OR across
 * selected values; range: min/max scan of the sorted array). Shared by
 * search() (candidate narrowing) and facetValues() (contextual counts
 * against every *other* active filter).
 */
export function unionDocsForField(
  facetShardsByField: Map<string, FacetShard>,
  filters: Record<string, string | string[] | RangeFilter> | undefined,
  field: string,
): Set<number> {
  const shard = facetShardsByField.get(field);
  const ids = new Set<number>();
  if (!shard) return ids;
  if (shard.type === "range") {
    const range = rangeFilterFor(filters, field);
    if (!range) return ids;
    // Linear scan over the sorted array rather than a binary-search
    // range lookup -- correct either way since the array is sorted,
    // and a full scan is negligible at "small corpus" JSON-tier
    // scale (docs/guides/indexing.md#what-to-simplify-at-this-scale).
    // Binary-searching the two endpoints is a documented future
    // optimization once shard size actually makes it matter.
    for (const entry of shard.sorted ?? []) {
      if (range.min !== undefined && entry.value < range.min) continue;
      if (range.max !== undefined && entry.value > range.max) continue;
      ids.add(entry.doc);
    }
    return ids;
  }
  for (const value of valuesFor(filters, field)) {
    for (const id of shard.values[value]?.docs ?? []) ids.add(id);
  }
  return ids;
}
