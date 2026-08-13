from pathlib import Path

from searchable.client.fetch import ShardCache
from searchable.client.search import search
from searchable.client.validate_manifest import validate_manifest
from tests.fixtures.build_index import (
    write_index_with_multi_doc_phrase_fixture,
    write_index_with_non_adjacent_pin,
    write_index_with_phrase_across_fields_fixture,
    write_index_with_phrase_fixture,
)


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


def test_pinned_non_adjacent_doc_gets_no_phrase_score_credit(tmp_path: Path):
    """Doc 2 is pinned for "noise cancelling" but only has the words present, not
    adjacent, so it bypasses organic candidate filtering entirely (pinned docs are
    scored directly). If the phrase clause appended the *unrestricted* postings for
    scoring instead of the adjacency-restricted ones, doc 2 would get a nonzero score
    from both "nois" and "cancel" postings; since the restriction correctly excludes
    doc 2 from those postings, its score for the phrase-only query must be exactly 0."""
    manifest_url = write_index_with_non_adjacent_pin(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    result = search('"noise cancelling"', manifest, cache, manifest_url)
    pinned_hits = [h for h in result.hits if h.pinned]
    assert [h.id for h in pinned_hits] == [2]
    assert pinned_hits[0].score == 0.0
    # doc 1 still matches organically (adjacent) and gets a real, nonzero score.
    organic_hits = [h for h in result.hits if not h.pinned]
    assert [h.id for h in organic_hits] == [1]
    assert organic_hits[0].score > 0.0


def test_quoted_phrase_does_not_match_across_different_fields(tmp_path: Path):
    """Phrase word 1 lives only in 'title', phrase word 2 only in 'body'. Both words are
    present in the document, but adjacency must be within one shared field, so the
    phrase query must not match even though a bare AND of the same words would."""
    manifest_url = write_index_with_phrase_across_fields_fixture(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    phrase_result = search('"noise cancelling"', manifest, cache, manifest_url)
    assert phrase_result.hits == []

    bare_result = search("noise cancelling", manifest, cache, manifest_url)
    assert [h.id for h in bare_result.hits] == [1]


def test_quoted_phrase_matches_across_multiple_documents(tmp_path: Path):
    """Docs 1 and 3 have the phrase adjacently; doc 2 does not. The phrase query must
    return exactly {1, 3}, confirming adjacency is checked per-document rather than
    only for the first matching doc encountered."""
    manifest_url = write_index_with_multi_doc_phrase_fixture(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    result = search('"noise cancelling"', manifest, cache, manifest_url)
    assert {h.id for h in result.hits} == {1, 3}
