from searchable_client.types import manifest_from_dict


def test_manifest_from_dict_maps_camel_case_to_snake_case():
    data = {
        "version": 1,
        "buildId": "abc123",
        "format": "json",
        "languages": ["en"],
        "defaultLanguage": "en",
        "fields": {"title": {"boost": 2.0, "stored": True}},
        "docCount": {"en": 10},
        "avgFieldLength": {"en": {"title": 5.0}},
        "shards": {
            "terms": [{"lang": "en", "prefix": "all", "file": "terms/all.json", "termCount": 3}],
            "docs": [{"shard": 0, "file": "docs/0.json", "idRange": [0, 9]}],
        },
    }
    manifest = manifest_from_dict(data)
    assert manifest.build_id == "abc123"
    assert manifest.default_language == "en"
    assert manifest.doc_count == {"en": 10}
    assert manifest.avg_field_length == {"en": {"title": 5.0}}
    assert manifest.fields["title"].boost == 2.0
    assert manifest.shards_terms[0].lang == "en"
    assert manifest.shards_terms[0].prefix == "all"
    assert manifest.shards_docs[0].id_range == (0, 9)
    assert manifest.pins is None
    assert manifest.synonyms is None
    assert manifest.fuzzy is None


def test_manifest_from_dict_reads_optional_pins_synonyms_fuzzy():
    data = {
        "version": 1,
        "buildId": "x",
        "format": "json",
        "languages": ["en"],
        "defaultLanguage": "en",
        "fields": {},
        "docCount": {"en": 1},
        "avgFieldLength": {"en": {}},
        "shards": {"terms": [], "docs": []},
        "pins": {"en": "pins/en.json"},
        "synonyms": {"en": "synonyms/en.json"},
        "fuzzy": {"en": {"file": "fuzzy/en.json", "format": "json"}},
    }
    manifest = manifest_from_dict(data)
    assert manifest.pins == {"en": "pins/en.json"}
    assert manifest.synonyms == {"en": "synonyms/en.json"}
    assert manifest.fuzzy is not None
    assert manifest.fuzzy["en"].file == "fuzzy/en.json"
    assert manifest.fuzzy["en"].format == "json"


def _base_manifest(fields: dict) -> dict:
    return {
        "version": 1,
        "buildId": "2026-01-01T00:00:00Z",
        "format": "json",
        "languages": ["en"],
        "defaultLanguage": "en",
        "fields": fields,
        "docCount": {"en": 1},
        "avgFieldLength": {"en": {}},
        "shards": {"terms": [], "docs": []},
    }


def test_old_manifest_shape_gets_indexed_true_default():
    manifest = manifest_from_dict(_base_manifest({"title": {"boost": 3.0, "stored": True}}))
    assert manifest.fields["title"].indexed is True
    assert manifest.fields["title"].boost == 3.0
    assert manifest.fields["title"].stored is True


def test_stored_only_field_without_boost_defaults_to_one():
    manifest = manifest_from_dict(_base_manifest({"excerpt": {"indexed": False, "stored": True}}))
    assert manifest.fields["excerpt"].boost == 1.0
    assert manifest.fields["excerpt"].indexed is False
