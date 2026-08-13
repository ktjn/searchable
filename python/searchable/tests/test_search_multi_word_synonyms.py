from pathlib import Path

from searchable.client.fetch import ShardCache
from searchable.client.search import SearchOptions, search
from searchable.client.validate_manifest import validate_manifest
from tests.fixtures.build_index import (
    write_index_with_multi_word_synonym,
    write_index_with_multi_word_synonym_literal_absent,
)


def _load_built(url: str, cache: ShardCache):
    manifest = validate_manifest(cache.fetch_json(url), url)
    return manifest


def test_multi_word_synonym_off_by_default(tmp_path: Path):
    manifest_url = write_index_with_multi_word_synonym(tmp_path / "idx")
    cache = ShardCache()
    manifest = _load_built(manifest_url, cache)
    result = search('"new york"', manifest, cache, manifest_url)
    assert [h.id for h in result.hits] == [2]


def test_multi_word_synonym_expands_phrase_variants(tmp_path: Path):
    manifest_url = write_index_with_multi_word_synonym(tmp_path / "idx")
    cache = ShardCache()
    manifest = _load_built(manifest_url, cache)
    result = search('"new york"', manifest, cache, manifest_url, SearchOptions(synonyms=True))
    assert {h.id for h in result.hits} == {1, 2, 3}


def test_multi_word_literal_phrase_ranks_above_expanded_variants(tmp_path: Path):
    manifest_url = write_index_with_multi_word_synonym(tmp_path / "idx")
    cache = ShardCache()
    manifest = _load_built(manifest_url, cache)
    result = search('"new york"', manifest, cache, manifest_url, SearchOptions(synonyms=True))
    assert result.hits[0].id == 2
    for hit in result.hits[1:]:
        assert hit.score < result.hits[0].score


def test_multi_word_variant_respects_synonym_weight(tmp_path: Path):
    manifest_url = write_index_with_multi_word_synonym(tmp_path / "idx")
    cache = ShardCache()
    manifest = _load_built(manifest_url, cache)
    result = search(
        '"new york"',
        manifest,
        cache,
        manifest_url,
        SearchOptions(synonyms=True, synonym_weight=0.01),
    )
    literal = next(h for h in result.hits if h.id == 2)
    expanded = next(h for h in result.hits if h.id == 1)
    assert expanded.score < literal.score * 0.1


def test_single_quoted_word_participates_in_multi_word_group(tmp_path: Path):
    manifest_url = write_index_with_multi_word_synonym(tmp_path / "idx")
    cache = ShardCache()
    manifest = _load_built(manifest_url, cache)
    result = search('"nyc"', manifest, cache, manifest_url, SearchOptions(synonyms=True))
    assert {h.id for h in result.hits} == {1, 2, 3}


def test_multi_word_variant_match_is_not_highlighted(tmp_path: Path):
    manifest_url = write_index_with_multi_word_synonym(tmp_path / "idx")
    cache = ShardCache()
    manifest = _load_built(manifest_url, cache)
    result = search(
        '"new york"',
        manifest,
        cache,
        manifest_url,
        SearchOptions(synonyms=True, highlight=True),
    )
    nyc_hit = next(h for h in result.hits if h.id == 1)
    spans = (nyc_hit.highlights or {}).get("title") or []
    assert not any(s.is_match for s in spans)


def test_multi_word_variant_matches_when_literal_words_absent_from_corpus(tmp_path: Path):
    manifest_url = write_index_with_multi_word_synonym_literal_absent(tmp_path / "idx")
    cache = ShardCache()
    manifest = _load_built(manifest_url, cache)
    with_synonyms = search(
        '"new york"', manifest, cache, manifest_url, SearchOptions(synonyms=True)
    )
    assert [h.id for h in with_synonyms.hits] == [5]
    without_synonyms = search('"new york"', manifest, cache, manifest_url)
    assert without_synonyms.hits == []
