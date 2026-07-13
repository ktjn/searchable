from searchable_indexer.synonyms import build_synonym_shards


def test_returns_empty_dict_for_none_input():
    assert build_synonym_shards(None) == {}


def test_normalizes_equivalences_through_the_language_pipeline():
    shards = build_synonym_shards(
        {"en": {"equivalences": [["Couch", "Sofa"]]}}
    )
    assert shards["en"]["equivalences"] == [["couch", "sofa"]]


def test_drops_single_member_equivalence_groups():
    # "widget" normalizes the same as itself and "widgets" also stems
    # to "widget" -- after dedup this collapses to one member, which
    # is dropped as nothing-left-to-expand-to.
    shards = build_synonym_shards(
        {"en": {"equivalences": [["widget", "widgets"]]}}
    )
    assert shards["en"].get("equivalences", []) == []


def test_normalizes_directional_keys_and_targets():
    shards = build_synonym_shards(
        {"en": {"directional": {"TV": ["Television", "Telly"]}}}
    )
    assert shards["en"]["directional"] == {"tv": ["televis", "telli"]}


def test_drops_directional_entry_with_empty_normalized_targets():
    shards = build_synonym_shards({"en": {"directional": {"a": [""]}}})
    assert shards["en"].get("directional", {}) == {}


def test_normalizes_multi_word_phrases_as_a_unit():
    shards = build_synonym_shards(
        {"en": {"multiWord": [["New York", "NYC", "Big Apple"]]}}
    )
    normalized = shards["en"]["multiWord"][0]
    assert "new york" in normalized
    assert "nyc" in normalized
    assert "big appl" in normalized


def test_multiple_languages_each_normalized_with_their_own_profile():
    shards = build_synonym_shards(
        {
            "en": {"equivalences": [["Couch", "Sofa"]]},
            "de": {"equivalences": [["Sofa", "Couch"]]},
        }
    )
    assert "en" in shards
    assert "de" in shards


def test_empty_source_produces_a_shard_with_no_keys():
    shards = build_synonym_shards({"en": {}})
    assert shards["en"] == {}
