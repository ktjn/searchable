from pathlib import Path

from searchable_client.fetch import ShardCache
from searchable_client.search import search
from searchable_client.validate_manifest import validate_manifest
from tests.fixtures.build_index import write_index_with_pins


def test_pinned_hit_appears_first_and_is_marked(tmp_path: Path):
    manifest_url = write_index_with_pins(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    result = search("widget", manifest, cache, manifest_url)
    assert result.hits[0].id == 2
    assert result.hits[0].pinned is True
    assert result.hits[1].pinned is False
