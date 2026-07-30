"""End-to-end coverage for search.py's three `if entry.format == "binary"` branches
(term shards, doc-store shards, fuzzy shards). test_binary_shards.py only exercises the
decoders directly against hand-assembled bytes using the same format assumptions the
decoders themselves encode -- it never runs a real query through search()/SearchClient
against a binary-format index, so a shared wrong assumption between the decoder and its
test would go undetected, and the binary branches in search.py had zero coverage. This
file drives real queries (exact term, prefix, fuzzy) through search() against
write_binary_format_index's genuinely binary-encoded fixture.
"""

from pathlib import Path

from searchable_client.fetch import ShardCache
from searchable_client.search import SearchOptions, search
from searchable_client.validate_manifest import validate_manifest
from tests.fixtures.build_index import write_binary_format_index


def _setup(tmp_path: Path):
    manifest_url = write_binary_format_index(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    return manifest, cache, manifest_url


def test_binary_exact_term_match(tmp_path: Path):
    manifest, cache, url = _setup(tmp_path)
    result = search("red", manifest, cache, url)
    assert result.total_hits == 1
    assert result.hits[0].id == 1
    assert result.hits[0].url == "https://example.com/1"
    assert result.hits[0].fields["title"] == "Red Widget"


def test_binary_shared_term_matches_both_docs(tmp_path: Path):
    manifest, cache, url = _setup(tmp_path)
    result = search("widget", manifest, cache, url)
    assert result.total_hits == 2
    assert {h.id for h in result.hits} == {1, 2}


def test_binary_prefix_query_matches_starting_terms(tmp_path: Path):
    manifest, cache, url = _setup(tmp_path)
    result = search("wid*", manifest, cache, url)
    assert result.total_hits == 2
    assert {h.id for h in result.hits} == {1, 2}


def test_binary_fuzzy_match(tmp_path: Path):
    manifest, cache, url = _setup(tmp_path)
    result = search("wdget", manifest, cache, url, SearchOptions(fuzzy=True))
    assert result.total_hits == 2
    assert {h.id for h in result.hits} == {1, 2}


def test_binary_and_matching_narrows_to_docs_with_all_terms(tmp_path: Path):
    manifest, cache, url = _setup(tmp_path)
    result = search("red widget", manifest, cache, url)
    assert result.total_hits == 1
    assert result.hits[0].id == 1
