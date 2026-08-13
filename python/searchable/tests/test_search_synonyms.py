from pathlib import Path

from searchable.client.fetch import ShardCache
from searchable.client.search import SearchOptions, search
from searchable.client.validate_manifest import validate_manifest
from tests.fixtures.build_index import (
    write_index_with_directional_synonym,
    write_index_with_synonym_double_match,
    write_index_with_synonym_fuzzy_overlap,
    write_index_with_synonyms,
)


def test_synonyms_off_by_default(tmp_path: Path):
    manifest_url = write_index_with_synonyms(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    result = search("sofa", manifest, cache, manifest_url)
    assert [h.id for h in result.hits] == [1]


def test_synonyms_expand_query_and_downweight_variant(tmp_path: Path):
    manifest_url = write_index_with_synonyms(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    result = search("sofa", manifest, cache, manifest_url, SearchOptions(synonyms=True))
    assert {h.id for h in result.hits} == {1, 2}
    literal_hit = next(h for h in result.hits if h.id == 1)
    synonym_hit = next(h for h in result.hits if h.id == 2)
    assert literal_hit.score > synonym_hit.score


def test_directional_synonym_expands_one_way_only(tmp_path: Path):
    manifest_url = write_index_with_directional_synonym(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)

    # Querying "tv" should expand to also match "television" (doc 1).
    tv_result = search("tv", manifest, cache, manifest_url, SearchOptions(synonyms=True))
    assert {h.id for h in tv_result.hits} == {1, 2}
    literal_hit = next(h for h in tv_result.hits if h.id == 2)
    synonym_hit = next(h for h in tv_result.hits if h.id == 1)
    assert literal_hit.score > synonym_hit.score

    # Querying "television" should NOT expand to match "tv" (doc 2) -- one-way only.
    television_result = search(
        "television", manifest, cache, manifest_url, SearchOptions(synonyms=True)
    )
    assert [h.id for h in television_result.hits] == [1]


def test_synonym_double_match_sums_literal_and_variant_clauses(tmp_path: Path):
    manifest_url = write_index_with_synonym_double_match(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)

    without_synonyms = search("sofa", manifest, cache, manifest_url)
    with_synonyms = search("sofa", manifest, cache, manifest_url, SearchOptions(synonyms=True))

    assert [h.id for h in without_synonyms.hits] == [1]
    assert [h.id for h in with_synonyms.hits] == [1]
    # Doc 1 matches via both the literal "sofa" clause (title) and the synonym-expanded
    # "couch" clause (description) -- its score with synonyms enabled should be strictly
    # greater than with synonyms disabled (extra credit from the synonym clause, not a
    # no-op or a clobber of the literal-term score).
    assert with_synonyms.hits[0].score > without_synonyms.hits[0].score


def test_term_reachable_via_synonym_and_fuzzy_is_not_double_counted(tmp_path: Path):
    manifest_url = write_index_with_synonym_fuzzy_overlap(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)

    result = search(
        "widget",
        manifest,
        cache,
        manifest_url,
        SearchOptions(synonyms=True, fuzzy=True),
    )
    assert {h.id for h in result.hits} == {1, 2}
    literal_hit = next(h for h in result.hits if h.id == 1)
    variant_hit = next(h for h in result.hits if h.id == 2)
    # "gadget" (doc 2) is reachable from the query term "widget" via BOTH the synonym
    # path and the fuzzy path. It must be added as a single clause -- at the synonym
    # weight, since synonym expansion is tried before fuzzy -- not summed across both
    # paths. Doc 1 and doc 2 have identical posting shapes/df, so the literal (weight
    # 1.0) and variant (weight synonym_weight) clauses produce proportional scores.
    assert variant_hit.score == literal_hit.score * SearchOptions().synonym_weight
