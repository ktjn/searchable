from pathlib import Path

from searchable_client.fetch import ShardCache
from searchable_client.search import SearchOptions, search, search_stream
from searchable_client.validate_manifest import validate_manifest
from tests.fixtures.build_index import write_index_with_synonyms


def _setup(tmp_path: Path):
    manifest_url = write_index_with_synonyms(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    return manifest, cache, manifest_url


def test_no_expansion_options_yields_exactly_one_result(tmp_path: Path):
    manifest, cache, url = _setup(tmp_path)
    results = list(search_stream("sofa", manifest, cache, url))
    assert len(results) == 1
    assert [h.id for h in results[0].hits] == [1]


def test_synonyms_enabled_yields_partial_then_final(tmp_path: Path):
    manifest, cache, url = _setup(tmp_path)
    options = SearchOptions(synonyms=True)
    results = list(search_stream("sofa", manifest, cache, url, options))
    assert len(results) == 2
    assert [h.id for h in results[0].hits] == [1]  # literal-only partial pass
    assert {h.id for h in results[1].hits} == {1, 2}  # final, synonym-expanded


def test_final_result_matches_plain_search(tmp_path: Path):
    manifest, cache, url = _setup(tmp_path)
    options = SearchOptions(synonyms=True)
    results = list(search_stream("sofa", manifest, cache, url, options))
    direct = search("sofa", manifest, cache, url, options)
    assert {h.id for h in results[-1].hits} == {h.id for h in direct.hits}
