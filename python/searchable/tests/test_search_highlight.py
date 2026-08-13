from pathlib import Path

from searchable.client.fetch import ShardCache
from searchable.client.search import SearchOptions, search
from searchable.client.validate_manifest import validate_manifest
from tests.fixtures.build_index import write_basic_index


def test_highlight_off_by_default(tmp_path: Path):
    manifest_url = write_basic_index(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    result = search("widget", manifest, cache, manifest_url)
    assert result.hits[0].highlights is None


def test_highlight_marks_literal_term_in_stored_field(tmp_path: Path):
    manifest_url = write_basic_index(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    result = search("widget", manifest, cache, manifest_url, SearchOptions(highlight=True))
    hit = next(h for h in result.hits if h.id == 1)
    title_spans = hit.highlights["title"]
    matched_text = "".join(s.text for s in title_spans if s.is_match)
    assert matched_text.lower() == "widget"
