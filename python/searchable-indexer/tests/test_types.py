from searchable_indexer.types import BuiltIndex, ExtractedDocument, PinDeclaration, SourceDocument


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
    built = BuiltIndex(manifest={"version": 1}, term_shards={}, doc_store={}, id_range=(0, 0))
    assert built.manifest["version"] == 1
    assert built.id_range == (0, 0)


def test_built_index_new_fields_default_to_empty_dicts():
    built = BuiltIndex(manifest={}, term_shards={}, doc_store={}, id_range=(0, 0))
    assert built.facet_shards == {}
    assert built.pins_shards == {}
    assert built.synonym_shards == {}
    assert built.fuzzy_shards == {}
