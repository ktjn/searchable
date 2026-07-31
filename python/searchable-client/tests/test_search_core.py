from pathlib import Path

from searchable_client.fetch import ShardCache
from searchable_client.search import SearchOptions, search
from searchable_client.validate_manifest import validate_manifest
from tests.fixtures.build_index import write_basic_index, write_index_with_doc_boost


def _setup(tmp_path: Path):
    manifest_url = write_basic_index(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    return manifest, cache, manifest_url


def test_matches_both_docs_for_shared_term(tmp_path: Path):
    manifest, cache, url = _setup(tmp_path)
    result = search("widget", manifest, cache, url)
    assert result.total_hits == 2
    assert {h.id for h in result.hits} == {1, 2}


def test_and_matching_narrows_to_docs_with_all_terms(tmp_path: Path):
    manifest, cache, url = _setup(tmp_path)
    result = search("red widget", manifest, cache, url)
    assert result.total_hits == 1
    assert result.hits[0].id == 1


def test_prefix_query_matches_starting_terms(tmp_path: Path):
    manifest, cache, url = _setup(tmp_path)
    result = search("wid*", manifest, cache, url)
    assert result.total_hits == 2


def test_no_match_returns_empty_result(tmp_path: Path):
    manifest, cache, url = _setup(tmp_path)
    result = search("nonexistent", manifest, cache, url)
    assert result.hits == []
    assert result.total_hits == 0


def test_limit_truncates_hits(tmp_path: Path):
    manifest, cache, url = _setup(tmp_path)
    result = search("widget", manifest, cache, url, SearchOptions(limit=1))
    assert len(result.hits) == 1
    assert result.total_hits == 2


def test_hit_has_url_and_fields_from_doc_store(tmp_path: Path):
    manifest, cache, url = _setup(tmp_path)
    result = search("red", manifest, cache, url)
    hit = result.hits[0]
    assert hit.url == "https://example.com/1"
    assert hit.fields["title"] == "Red Widget"


def test_per_document_boost_is_applied_to_ranking(tmp_path: Path):
    manifest_url = write_index_with_doc_boost(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    result = search("widget", manifest, cache, manifest_url)
    assert result.total_hits == 2
    scores_by_id = {h.id: h.score for h in result.hits}
    # Identical postings/fields except doc 1's posting carries boost=10.0 -- without
    # applying it, both scores would be exactly equal.
    assert scores_by_id[1] == scores_by_id[2] * 10.0
    assert scores_by_id[1] > scores_by_id[2]
    assert result.hits[0].id == 1
