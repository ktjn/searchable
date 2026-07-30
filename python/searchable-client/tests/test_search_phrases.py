from pathlib import Path

from searchable_client.fetch import ShardCache
from searchable_client.search import search
from searchable_client.validate_manifest import validate_manifest
from tests.fixtures.build_index import write_index_with_phrase_fixture


def test_quoted_phrase_only_matches_adjacent_occurrence(tmp_path: Path):
    manifest_url = write_index_with_phrase_fixture(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    result = search('"noise cancelling"', manifest, cache, manifest_url)
    assert [h.id for h in result.hits] == [1]


def test_bare_and_of_same_words_matches_both_docs(tmp_path: Path):
    manifest_url = write_index_with_phrase_fixture(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    result = search("noise cancelling", manifest, cache, manifest_url)
    assert {h.id for h in result.hits} == {1, 2}
