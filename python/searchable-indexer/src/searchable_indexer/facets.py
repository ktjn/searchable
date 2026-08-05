import math
from typing import Any

# Direct port of packages/indexer/src/build-index.ts's addFacetValues /
# addRangeFacetValues / expandHierarchyPaths /
# computeRangeFacetBuckets{EqualWidth,Explicit} / addToBucket /
# formatBucketBound.

DEFAULT_HIERARCHY_SEPARATOR = ">"
RANGE_FACET_BUCKET_COUNT = 5


def expand_hierarchy_paths(full_path: str, separator: str) -> list[str]:
    segments = [s.strip() for s in full_path.split(separator) if s.strip()]
    if not segments:
        return [full_path]
    return [separator.join(segments[: i + 1]) for i in range(len(segments))]


def add_facet_values(
    facet_shards: dict[str, dict[str, Any]],
    facets: dict[str, list[str]],
    doc_id: int,
    hierarchical_facets: dict[str, dict[str, Any]],
) -> None:
    for field_name, values in facets.items():
        hierarchy_config = hierarchical_facets.get(field_name)
        shard = facet_shards.get(field_name)
        if shard is None:
            if hierarchy_config is not None:
                shard = {
                    "type": "hierarchy",
                    "separator": hierarchy_config.get("separator", DEFAULT_HIERARCHY_SEPARATOR),
                    "values": {},
                }
            else:
                shard = {"type": "terms", "values": {}}
            facet_shards[field_name] = shard
        elif shard["type"] not in ("terms", "hierarchy"):
            # Same field also declared as a range facet elsewhere --
            # first declaration wins.
            continue

        # A doc's own distinct values can still overlap at an ancestor
        # level once expanded -- union into a set first so a shared
        # ancestor is only counted once for this document.
        paths: set[str] = set()
        for value in values:
            if shard["type"] == "hierarchy":
                separator = shard.get("separator", DEFAULT_HIERARCHY_SEPARATOR)
                paths.update(expand_hierarchy_paths(value, separator))
            else:
                paths.add(value)

        for path in paths:
            entry = shard["values"].setdefault(path, {"count": 0, "docs": []})
            entry["docs"].append(doc_id)
            entry["count"] += 1


def add_range_facet_values(
    facet_shards: dict[str, dict[str, Any]],
    range_facets: dict[str, float],
    doc_id: int,
) -> None:
    for field_name, value in range_facets.items():
        shard = facet_shards.get(field_name)
        if shard is None:
            shard = {"type": "range", "values": {}, "sorted": []}
            facet_shards[field_name] = shard
        elif shard["type"] != "range":
            # Same field also declared as a terms facet elsewhere --
            # first declaration wins.
            continue
        shard["sorted"].append({"value": value, "doc": doc_id})


def _format_bucket_bound(n: float) -> str:
    rounded = round(n, 2)
    if rounded == int(rounded):
        return str(int(rounded))
    return str(rounded)


def _add_to_bucket(shard: dict[str, Any], label: str, doc: int) -> None:
    entry = shard["values"].get(label)
    if entry is None:
        entry = {"count": 0, "docs": []}
        shard["values"][label] = entry
    entry["docs"].append(doc)
    entry["count"] += 1


def compute_range_facet_buckets_equal_width(shard: dict[str, Any], bucket_count: int) -> None:
    sorted_entries = shard.get("sorted", [])
    if not sorted_entries:
        return
    min_value = sorted_entries[0]["value"]
    max_value = sorted_entries[-1]["value"]

    if min_value == max_value:
        shard["values"][_format_bucket_bound(min_value)] = {
            "count": len(sorted_entries),
            "docs": [e["doc"] for e in sorted_entries],
        }
        return

    width = (max_value - min_value) / bucket_count
    labels = []
    for i in range(bucket_count):
        lo = min_value + i * width
        hi = min_value + (i + 1) * width
        if i == bucket_count - 1:
            labels.append(f"{_format_bucket_bound(lo)}+")
        else:
            labels.append(f"{_format_bucket_bound(lo)}-{_format_bucket_bound(hi)}")

    for entry in sorted_entries:
        index = min(bucket_count - 1, math.floor((entry["value"] - min_value) / width))
        _add_to_bucket(shard, labels[index], entry["doc"])


def compute_range_facet_buckets_explicit(shard: dict[str, Any], boundaries: list[float]) -> None:
    sorted_entries = shard.get("sorted", [])
    if not sorted_entries:
        return

    labels = []
    for i, b in enumerate(boundaries):
        if i == 0:
            labels.append(f"<{_format_bucket_bound(b)}")
        else:
            labels.append(f"{_format_bucket_bound(boundaries[i - 1])}-{_format_bucket_bound(b)}")
    labels.append(f"{_format_bucket_bound(boundaries[-1])}+")

    for entry in sorted_entries:
        index = next(
            (i for i, b in enumerate(boundaries) if entry["value"] < b),
            len(boundaries),
        )
        _add_to_bucket(shard, labels[index], entry["doc"])
