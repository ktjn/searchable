from pathlib import Path

from searchable_client.fetch import ShardCache
from searchable_client.search import FacetValuesOptions, SearchOptions, facet_values, search
from searchable_client.validate_manifest import validate_manifest
from tests.fixtures.build_index import (
    write_index_with_category_facet,
    write_index_with_hierarchy_facet,
    write_index_with_range_facet,
    write_index_with_two_facets,
)


def _setup(tmp_path: Path, builder=write_index_with_category_facet):
    manifest_url = builder(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    return manifest, cache, manifest_url


def test_filter_narrows_candidates(tmp_path: Path):
    manifest, cache, url = _setup(tmp_path)
    result = search("widget", manifest, cache, url, SearchOptions(filters={"category": "red"}))
    assert [h.id for h in result.hits] == [1]


def test_filter_with_multiple_values_is_or(tmp_path: Path):
    manifest, cache, url = _setup(tmp_path)
    options = SearchOptions(filters={"category": ["red", "blue"]})
    result = search("widget", manifest, cache, url, options)
    assert result.total_hits == 2


def test_requested_facets_are_included_with_contextual_counts(tmp_path: Path):
    manifest, cache, url = _setup(tmp_path)
    result = search("widget", manifest, cache, url, SearchOptions(facets=["category"]))
    assert result.facets is not None
    values = {v.value: v.count for v in result.facets["category"].values}
    assert values == {"red": 1, "blue": 1}


def test_facet_values_standalone_query(tmp_path: Path):
    manifest, cache, url = _setup(tmp_path)
    result = facet_values("category", manifest, cache, url)
    values = {v.value: v.count for v in result.values}
    assert values == {"red": 1, "blue": 1}


def test_facet_values_reports_selected(tmp_path: Path):
    manifest, cache, url = _setup(tmp_path)
    options = FacetValuesOptions(filters={"category": "red"})
    result = facet_values("category", manifest, cache, url, options)
    selected = {v.value: v.selected for v in result.values}
    assert selected == {"red": True, "blue": False}


def test_two_simultaneous_filters_and_contextual_counts_exclude_own_field(tmp_path: Path):
    manifest, cache, url = _setup(tmp_path, write_index_with_two_facets)
    options = SearchOptions(
        filters={"category": "red", "stock": "in-stock"},
        facets=["category", "stock"],
    )
    result = search("widget", manifest, cache, url, options)

    # Both filters are ANDed: category=red -> docs {1,2}, stock=in-stock -> docs
    # {1,3}; only doc 1 satisfies both.
    assert result.total_hits == 1
    assert [h.id for h in result.hits] == [1]

    assert result.facets is not None
    # category's contextual counts must be computed against the candidate set
    # filtered by *stock only* (excluding category's own filter), i.e. docs {1,3}
    # (stock=in-stock). Doc 1 is red, doc 3 is blue, so counts are red:1, blue:1.
    # A buggy implementation that fails to exclude category's own filter would
    # instead compute against the doubly-filtered set {1} only, giving
    # {"red": 1, "blue": 0} -- which differs from the correct result below.
    category_counts = {v.value: v.count for v in result.facets["category"].values}
    assert category_counts == {"red": 1, "blue": 1}

    # stock's contextual counts must be computed against the candidate set filtered
    # by *category only* (excluding stock's own filter), i.e. docs {1,2}
    # (category=red). Doc 1 is in-stock, doc 2 is out-of-stock, so counts are
    # in-stock:1, out-of-stock:1. A buggy implementation would instead compute
    # against {1} only, giving {"in-stock": 1, "out-of-stock": 0}.
    stock_counts = {v.value: v.count for v in result.facets["stock"].values}
    assert stock_counts == {"in-stock": 1, "out-of-stock": 1}


def test_range_facet_filter_returns_docs_within_bounds(tmp_path: Path):
    manifest, cache, url = _setup(tmp_path, write_index_with_range_facet)
    options = SearchOptions(filters={"price": {"min": 20.0, "max": 60.0}})
    result = search("widget", manifest, cache, url, options)
    assert [h.id for h in result.hits] == [2]
    assert result.total_hits == 1


def test_hierarchy_facet_reports_separator(tmp_path: Path):
    manifest, cache, url = _setup(tmp_path, write_index_with_hierarchy_facet)
    result = search("widget", manifest, cache, url, SearchOptions(facets=["category"]))
    assert result.facets is not None
    assert result.facets["category"].separator == "/"
