from searchable.client.types import manifest_from_dict
from searchable.indexer.types import BuiltIndex, ExtractedDocument, PinDeclaration, SourceDocument


def test_source_document_holds_id_url_html():
    doc = SourceDocument(id=1, url="/foo", html="<html></html>")
    assert doc.id == 1
    assert doc.url == "/foo"


def test_pin_declaration_fields():
    pin = PinDeclaration(phrase="widgets", mode="exact", priority=0.0, exclusive=False)
    assert pin.mode == "exact"


def test_extracted_document_fields():
    doc = ExtractedDocument(
        title="Widgets",
        language="en",
        body="Our widgets are great.",
        excerpt="",
        url="/widgets",
        noindex=False,
        boost=1.0,
        facets={},
        range_facets={},
        pins=[],
    )
    assert doc.title == "Widgets"
    assert doc.pins == []


def test_built_index_fields():
    built = BuiltIndex(manifest={"version": 2}, term_shards={}, doc_store={}, id_range=(0, 0))
    assert built.manifest["version"] == 2
    assert built.id_range == (0, 0)


def test_built_index_new_fields_default_to_empty_dicts():
    built = BuiltIndex(manifest={}, term_shards={}, doc_store={}, id_range=(0, 0))
    assert built.facet_shards == {}
    assert built.pins_shards == {}
    assert built.synonym_shards == {}
    assert built.fuzzy_shards == {}


def test_manifest_from_dict_maps_camel_case_to_snake_case():
    data = {
        "version": 2,
        "buildId": "abc123",
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
        "version": 2,
        "buildId": "x",
        "languages": ["en"],
        "defaultLanguage": "en",
        "fields": {},
        "docCount": {"en": 1},
        "avgFieldLength": {"en": {}},
        "shards": {"terms": [], "docs": []},
        "pins": {"en": "pins/en.json"},
        "synonyms": {"en": "synonyms/en.json"},
        "fuzzy": {"en": {"file": "fuzzy/en.json"}},
    }
    manifest = manifest_from_dict(data)
    assert manifest.pins == {"en": "pins/en.json"}
    assert manifest.synonyms == {"en": "synonyms/en.json"}
    assert manifest.fuzzy is not None
    assert manifest.fuzzy["en"].file == "fuzzy/en.json"


def _base_manifest(fields: dict) -> dict:
    return {
        "version": 2,
        "buildId": "2026-01-01T00:00:00Z",
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
