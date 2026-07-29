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
        "version": 1, "buildId": "x", "format": "json",
        "languages": ["en"], "defaultLanguage": "en",
        "fields": {}, "docCount": {"en": 1}, "avgFieldLength": {"en": {}},
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
