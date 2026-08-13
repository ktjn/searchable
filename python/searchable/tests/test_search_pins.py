from pathlib import Path

from searchable.client.fetch import ShardCache
from searchable.client.search import SearchOptions, search
from searchable.client.validate_manifest import validate_manifest
from tests.fixtures.build_index import (
    write_index_with_contains_pin,
    write_index_with_exact_phrase_pin,
    write_index_with_exclusive_pin,
    write_index_with_multi_pins,
    write_index_with_pin_excluded_by_filter,
    write_index_with_pin_for_unindexed_query,
    write_index_with_pins,
)


def test_pinned_hit_appears_first_and_is_marked(tmp_path: Path):
    manifest_url = write_index_with_pins(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    result = search("widget", manifest, cache, manifest_url)
    assert result.hits[0].id == 2
    assert result.hits[0].pinned is True
    assert result.hits[1].pinned is False


def test_contains_mode_matches_substring_phrase(tmp_path: Path):
    """A "contains"-mode pin phrase ('red widget') should match when the query merely
    contains it as a contiguous subsequence of tokens, not just when the whole query
    equals the phrase."""
    manifest_url = write_index_with_contains_pin(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    result = search("buy red widget now", manifest, cache, manifest_url)
    pinned_ids = {h.id for h in result.hits if h.pinned}
    assert pinned_ids == {2}


def test_exact_mode_does_not_match_when_phrase_is_only_a_substring(tmp_path: Path):
    """The same phrase ('red widget'), but registered as "exact" mode, must NOT match a
    query where the phrase is merely a substring ("buy red widget now" != "red widget")."""
    manifest_url = write_index_with_exact_phrase_pin(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    result = search("buy red widget now", manifest, cache, manifest_url)
    assert all(not h.pinned for h in result.hits)


def test_exclusive_pin_suppresses_organic_hits(tmp_path: Path):
    """A query ("widget") that matches both docs organically also matches an exclusive
    pin on doc 2. Only the pinned hit should be returned, and total_hits should reflect
    just the pinned count, not the organic candidate count too."""
    manifest_url = write_index_with_exclusive_pin(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    result = search("widget", manifest, cache, manifest_url)
    assert len(result.hits) == 1
    assert result.hits[0].id == 2
    assert result.hits[0].pinned is True
    assert result.total_hits == 1


def test_pin_excluded_by_active_filter(tmp_path: Path):
    """doc 2 (category=blue) is pinned for the query "widget", but an active
    filters={"category": "red"} excludes it (doc 2 doesn't satisfy the filter), so the
    filter should override the pin and doc 2 should not appear in the results at all."""
    manifest_url = write_index_with_pin_excluded_by_filter(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    result = search(
        "widget", manifest, cache, manifest_url, SearchOptions(filters={"category": "red"})
    )
    assert all(h.id != 2 for h in result.hits)
    assert all(not h.pinned for h in result.hits)
    assert result.hits[0].id == 1
    assert result.total_hits == 1


def test_pin_surfaces_when_organic_match_fails_entirely(tmp_path: Path):
    """The query ("gizmo") doesn't exist in any term shard, so the organic match fails
    completely, but a pin phrase matching the query text should still surface its hit."""
    manifest_url = write_index_with_pin_for_unindexed_query(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    result = search("gizmo", manifest, cache, manifest_url)
    assert len(result.hits) == 1
    assert result.hits[0].id == 1
    assert result.hits[0].pinned is True
    assert result.total_hits == 1


def test_duplicate_pin_dedup_and_priority_descending_order(tmp_path: Path):
    """Two contains-mode pin phrases ('red' and 'widget') both match query "red widget".
    Doc 2 is pinned by both (priorities 5.0 and 20.0) and doc 1 is pinned once (priority
    8.0). Doc 2 must appear only once (using the higher-priority 20.0 entry), and the
    pinned hits must be ordered by descending priority: doc 2, then doc 1."""
    manifest_url = write_index_with_multi_pins(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    result = search("red widget", manifest, cache, manifest_url)
    pinned_hits = [h for h in result.hits if h.pinned]
    assert [h.id for h in pinned_hits] == [2, 1]
    assert len([h for h in result.hits if h.id == 2]) == 1
