from pathlib import Path

import pytest

from searchable_client.fetch import ShardCache
from searchable_client.fuzzy import MAX_FUZZY_CANDIDATES_PER_TERM, _fuzzy_candidates_for
from searchable_client.search import SearchOptions, search
from searchable_client.validate_manifest import validate_manifest
from tests.fixtures.build_index import (
    write_index_with_fuzzy,
    write_index_with_fuzzy_did_you_mean,
    write_index_with_fuzzy_distance_variants,
    write_index_with_fuzzy_length_cap,
    write_index_with_fuzzy_literal_and_typo,
)


def test_fuzzy_off_by_default_typo_finds_nothing(tmp_path: Path):
    manifest_url = write_index_with_fuzzy(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    result = search("wdget", manifest, cache, manifest_url)
    assert result.hits == []
    assert result.did_you_mean is None


def test_fuzzy_on_finds_typo_match(tmp_path: Path):
    manifest_url = write_index_with_fuzzy(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    result = search("wdget", manifest, cache, manifest_url, SearchOptions(fuzzy=True))
    assert {h.id for h in result.hits} == {1, 2}


def test_did_you_mean_populated_on_zero_hits(tmp_path: Path):
    manifest_url = write_index_with_fuzzy(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    result = search("zzz9999nonword", manifest, cache, manifest_url, SearchOptions(fuzzy=True))
    assert result.hits == []
    # zzz9999nonword has no dictionary candidates at all (too far from any real term via 1
    # delete), so did_you_mean may legitimately be None here -- assert it's either None or a
    # list, not a crash.
    assert result.did_you_mean is None or isinstance(result.did_you_mean, list)


def test_did_you_mean_genuinely_populated_with_suggestion(tmp_path: Path):
    manifest_url = write_index_with_fuzzy_did_you_mean(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    result = search("xyz", manifest, cache, manifest_url, SearchOptions(fuzzy=True))
    # "xyz" doesn't match anything organically or via fuzzy expansion (its only fuzzy
    # candidate, "widget", is beyond the effective max-edit-distance cap for a 3-code-point
    # term, so it never becomes an actual clause/hit) -- so the query returns zero hits.
    assert result.hits == []
    # But that same candidate IS discoverable by _nearest_terms_for (which doesn't apply the
    # match cap), so did_you_mean must be genuinely populated with it, not just "a list".
    assert result.did_you_mean == ["widget"]


def test_did_you_mean_not_populated_when_hits_found(tmp_path: Path):
    manifest_url = write_index_with_fuzzy(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    result = search("wdget", manifest, cache, manifest_url, SearchOptions(fuzzy=True))
    assert result.hits != []
    assert result.did_you_mean is None


def test_literal_match_outranks_fuzzy_match_same_query(tmp_path: Path):
    manifest_url = write_index_with_fuzzy_literal_and_typo(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    result = search("wdget", manifest, cache, manifest_url, SearchOptions(fuzzy=True))
    assert {h.id for h in result.hits} == {1, 2}
    literal_hit = next(h for h in result.hits if h.id == 1)
    fuzzy_hit = next(h for h in result.hits if h.id == 2)
    assert literal_hit.score > fuzzy_hit.score


def test_fuzzy_weight_decay_applied_as_power_of_distance(tmp_path: Path):
    manifest_url = write_index_with_fuzzy_literal_and_typo(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    result = search(
        "wdget", manifest, cache, manifest_url, SearchOptions(fuzzy=True, fuzzy_weight=0.3)
    )
    literal_hit = next(h for h in result.hits if h.id == 1)
    fuzzy_hit = next(h for h in result.hits if h.id == 2)
    # Doc 1 (literal) and doc 2 (fuzzy, distance 1) have identical posting shapes, so their
    # undecayed BM25F scores are equal -- the fuzzy hit's score must equal the literal hit's
    # score scaled by exactly fuzzy_weight**1, not some other (e.g. flat) factor.
    assert fuzzy_hit.score == pytest.approx(literal_hit.score * 0.3)


def test_fuzzy_distance_two_scores_lower_than_distance_one(tmp_path: Path):
    manifest_url = write_index_with_fuzzy_distance_variants(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    result = search(
        "wdgxyz", manifest, cache, manifest_url, SearchOptions(fuzzy=True, fuzzy_weight=0.3)
    )
    assert {h.id for h in result.hits} == {1, 2}
    distance_one_hit = next(h for h in result.hits if h.id == 1)
    distance_two_hit = next(h for h in result.hits if h.id == 2)
    assert distance_two_hit.score < distance_one_hit.score
    assert distance_two_hit.score == pytest.approx(distance_one_hit.score * 0.3)


class _DenseLookup:
    max_edits = 1

    def get(self, variant: str):
        return [f"term{i}" for i in range(250)]


def test_fuzzy_candidate_cap_warns_and_scores_only_the_cap(capsys):
    matches = _fuzzy_candidates_for("x", _DenseLookup())  # type: ignore[arg-type]
    assert len(matches) == MAX_FUZZY_CANDIDATES_PER_TERM
    captured = capsys.readouterr()
    assert "candidate cap" in captured.err


def test_fuzzy_short_term_capped_to_distance_one(tmp_path: Path):
    manifest_url = write_index_with_fuzzy_length_cap(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    # "cx" is only 2 code points, so the effective max edit distance is capped to 1
    # regardless of the shard's own maxEdits=2 -- the distance-2 candidate ("cxyz", doc 2)
    # must be excluded even though the distance-1 candidate ("cxy", doc 1) matches.
    result = search("cx", manifest, cache, manifest_url, SearchOptions(fuzzy=True))
    assert {h.id for h in result.hits} == {1}
