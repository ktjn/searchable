"""Facet shard fetching, filter interpretation, and per-field doc-id
narrowing for the search client (mirrors packages/client/src/facets.ts).
"""

from typing import Any

from searchable_client.fetch import ShardCache, resolve_url
from searchable_client.types import FacetShard, Manifest, facet_shard_from_dict


def _is_range_filter(value: Any) -> bool:
    return isinstance(value, dict) and ("min" in value or "max" in value)


def _values_for(filters: dict[str, Any] | None, field_name: str) -> list[str]:
    raw = (filters or {}).get(field_name)
    if raw is None or _is_range_filter(raw):
        return []
    return raw if isinstance(raw, list) else [raw]


def _range_filter_for(filters: dict[str, Any] | None, field_name: str) -> dict[str, Any] | None:
    raw = (filters or {}).get(field_name)
    return raw if _is_range_filter(raw) else None


def _fetch_facet_shards(
    manifest: Manifest, cache: ShardCache, base_url: str, fields: list[str]
) -> dict[str, FacetShard]:
    result = {}
    for entry in manifest.shards_facets:
        if entry.field in fields:
            raw = cache.fetch_json(resolve_url(base_url, entry.file))
            result[entry.field] = facet_shard_from_dict(raw)
    return result


def _union_docs_for_field(
    facet_shards_by_field: dict[str, FacetShard], filters: dict[str, Any] | None, field_name: str
) -> set[int]:
    shard = facet_shards_by_field.get(field_name)
    if shard is None:
        return set()
    ids: set[int] = set()
    if shard.type == "range":
        range_filter = _range_filter_for(filters, field_name)
        if not range_filter:
            return ids
        for range_entry in shard.sorted or []:
            if (
                "min" in range_filter
                and range_filter["min"] is not None
                and range_entry.value < range_filter["min"]
            ):
                continue
            if (
                "max" in range_filter
                and range_filter["max"] is not None
                and range_entry.value > range_filter["max"]
            ):
                continue
            ids.add(range_entry.doc)
        return ids
    for value in _values_for(filters, field_name):
        value_entry = shard.values.get(value)
        if value_entry:
            ids.update(value_entry.docs)
    return ids
