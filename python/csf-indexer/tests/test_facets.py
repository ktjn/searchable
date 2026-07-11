from csf_indexer.facets import (
    RANGE_FACET_BUCKET_COUNT,
    add_facet_values,
    add_range_facet_values,
    compute_range_facet_buckets_equal_width,
    compute_range_facet_buckets_explicit,
    expand_hierarchy_paths,
)


def test_expand_hierarchy_paths_returns_every_ancestor_plus_self():
    assert expand_hierarchy_paths("a>b>c", ">") == ["a", "a>b", "a>b>c"]


def test_expand_hierarchy_paths_with_no_separator_returns_just_itself():
    assert expand_hierarchy_paths("standalone", ">") == ["standalone"]


def test_add_facet_values_terms_facet_counts_and_collects_doc_ids():
    shards: dict[str, dict] = {}
    add_facet_values(shards, {"color": ["red", "blue"]}, 1, {})
    add_facet_values(shards, {"color": ["red"]}, 2, {})
    assert shards["color"]["type"] == "terms"
    assert shards["color"]["values"]["red"] == {"count": 2, "docs": [1, 2]}
    assert shards["color"]["values"]["blue"] == {"count": 1, "docs": [1]}


def test_add_facet_values_hierarchy_facet_dedupes_shared_ancestor():
    shards: dict[str, dict] = {}
    add_facet_values(
        shards,
        {"category": ["a>b", "a>c"]},
        1,
        {"category": {}},
    )
    # "a" is a shared ancestor of both "a>b" and "a>c" -- must only be
    # counted once for this one document, not twice.
    assert shards["category"]["values"]["a"]["count"] == 1
    assert shards["category"]["values"]["a>b"]["count"] == 1
    assert shards["category"]["values"]["a>c"]["count"] == 1


def test_add_facet_values_hierarchy_facet_respects_custom_separator():
    shards: dict[str, dict] = {}
    add_facet_values(
        shards,
        {"category": ["a/b"]},
        1,
        {"category": {"separator": "/"}},
    )
    assert shards["category"]["separator"] == "/"
    assert "a/b" in shards["category"]["values"]
    assert "a" in shards["category"]["values"]


def test_add_facet_values_first_declaration_wins_over_range_facet_conflict():
    shards: dict[str, dict] = {"price": {"type": "range", "values": {}, "sorted": []}}
    add_facet_values(shards, {"price": ["cheap"]}, 1, {})
    # Already declared as a range facet -- terms declaration is ignored.
    assert shards["price"]["type"] == "range"
    assert "cheap" not in shards["price"]["values"]


def test_add_range_facet_values_appends_to_sorted():
    shards: dict[str, dict] = {}
    add_range_facet_values(shards, {"price": 19.99}, 1)
    add_range_facet_values(shards, {"price": 5.0}, 2)
    assert shards["price"]["type"] == "range"
    assert shards["price"]["sorted"] == [
        {"value": 19.99, "doc": 1},
        {"value": 5.0, "doc": 2},
    ]


def test_compute_range_facet_buckets_equal_width_single_distinct_value():
    shard = {
        "type": "range",
        "values": {},
        "sorted": [{"value": 10.0, "doc": 1}, {"value": 10.0, "doc": 2}],
    }
    compute_range_facet_buckets_equal_width(shard, RANGE_FACET_BUCKET_COUNT)
    assert shard["values"] == {"10": {"count": 2, "docs": [1, 2]}}


def test_compute_range_facet_buckets_equal_width_spreads_across_buckets():
    shard = {
        "type": "range",
        "values": {},
        "sorted": [
            {"value": 0.0, "doc": 1},
            {"value": 50.0, "doc": 2},
            {"value": 100.0, "doc": 3},
        ],
    }
    compute_range_facet_buckets_equal_width(shard, 2)
    # width = 50; bucket 0 = [0,50), bucket 1 (last, open-ended) = [50,100]
    assert shard["values"]["0-50"]["docs"] == [1]
    assert shard["values"]["50+"]["docs"] == [2, 3]


def test_compute_range_facet_buckets_explicit_uses_author_boundaries():
    shard = {
        "type": "range",
        "values": {},
        "sorted": [
            {"value": 10.0, "doc": 1},
            {"value": 30.0, "doc": 2},
            {"value": 60.0, "doc": 3},
        ],
    }
    compute_range_facet_buckets_explicit(shard, [25, 50])
    assert shard["values"]["<25"]["docs"] == [1]
    assert shard["values"]["25-50"]["docs"] == [2]
    assert shard["values"]["50+"]["docs"] == [3]


def test_compute_range_facet_buckets_does_nothing_for_empty_sorted():
    shard = {"type": "range", "values": {}, "sorted": []}
    compute_range_facet_buckets_equal_width(shard, RANGE_FACET_BUCKET_COUNT)
    assert shard["values"] == {}
