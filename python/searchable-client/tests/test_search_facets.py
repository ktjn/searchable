from pathlib import Path

from searchable_client.fetch import ShardCache
from searchable_client.search import FacetValuesOptions, SearchOptions, facet_values, search
from searchable_client.validate_manifest import validate_manifest
from tests.fixtures.build_index import write_index_with_category_facet


def _setup(tmp_path: Path):
    manifest_url = write_index_with_category_facet(tmp_path / "idx")
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
