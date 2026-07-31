import math

import pytest

from searchable_indexer.build_index import build_index_documents
from searchable_indexer.document import FieldDefinition, IndexDocument


def _fields(**overrides) -> dict[str, FieldDefinition]:
    base = {
        "title": FieldDefinition(indexed=True, stored=True, boost=3.0),
        "body": FieldDefinition(indexed=True, stored=False, boost=1.0),
        "excerpt": FieldDefinition(indexed=False, stored=True),
    }
    base.update(overrides)
    return base


def _doc(doc_id=1, **overrides) -> IndexDocument:
    base = dict(
        id=doc_id,
        url=f"/doc-{doc_id}",
        language="en",
        indexed_fields={"title": "Widgets", "body": "widgets are great"},
        stored_fields={"title": "Widgets", "excerpt": "widgets are great"},
    )
    base.update(overrides)
    return IndexDocument(**base)


def test_neither_indexed_nor_stored_field_definition_rejected():
    with pytest.raises(ValueError, match="neither indexed nor stored"):
        build_index_documents(
            [_doc()], field_definitions=_fields(title=FieldDefinition(indexed=False, stored=False))
        )


def test_negative_field_boost_rejected():
    with pytest.raises(ValueError, match="boost"):
        build_index_documents([_doc()], field_definitions=_fields(title=FieldDefinition(boost=-1.0)))


def test_non_finite_field_boost_rejected():
    with pytest.raises(ValueError, match="boost"):
        build_index_documents(
            [_doc()], field_definitions=_fields(title=FieldDefinition(boost=float("nan")))
        )


def test_bool_field_boost_rejected():
    with pytest.raises(ValueError, match="boost"):
        build_index_documents([_doc()], field_definitions=_fields(title=FieldDefinition(boost=True)))


def test_negative_document_id_rejected():
    with pytest.raises(ValueError, match="document id"):
        build_index_documents([_doc(doc_id=-1)], field_definitions=_fields())


def test_duplicate_document_id_rejected():
    with pytest.raises(ValueError, match="duplicate document id"):
        build_index_documents([_doc(doc_id=1), _doc(doc_id=1)], field_definitions=_fields())


def test_empty_external_id_rejected():
    with pytest.raises(ValueError, match="external_id"):
        build_index_documents([_doc(external_id="")], field_definitions=_fields())


def test_duplicate_external_id_rejected():
    docs = [_doc(doc_id=1, external_id="a"), _doc(doc_id=2, external_id="a")]
    with pytest.raises(ValueError, match="duplicate external_id"):
        build_index_documents(docs, field_definitions=_fields())


def test_undeclared_indexed_field_rejected():
    doc = _doc(indexed_fields={"title": "Widgets", "code": "print(1)"})
    with pytest.raises(ValueError, match='"code"'):
        build_index_documents([doc], field_definitions=_fields())


def test_indexed_field_not_declared_indexed_rejected():
    doc = _doc(indexed_fields={"title": "Widgets", "excerpt": "e"})
    with pytest.raises(ValueError, match='"excerpt"'):
        build_index_documents([doc], field_definitions=_fields())


def test_undeclared_stored_field_rejected():
    doc = _doc(stored_fields={"title": "Widgets", "code": "print(1)"})
    with pytest.raises(ValueError, match='"code"'):
        build_index_documents([doc], field_definitions=_fields())


def test_non_string_indexed_field_value_rejected():
    doc = _doc(indexed_fields={"title": "Widgets", "body": 123})
    with pytest.raises(ValueError, match="string"):
        build_index_documents([doc], field_definitions=_fields())


def test_empty_indexed_fields_rejected():
    doc = _doc(indexed_fields={})
    with pytest.raises(ValueError, match="no indexed fields"):
        build_index_documents([doc], field_definitions=_fields())


def test_missing_field_on_individual_document_is_allowed():
    doc = _doc(indexed_fields={"title": "Widgets"}, stored_fields={"title": "Widgets"})
    built = build_index_documents([doc], field_definitions=_fields())
    assert built.doc_store["1"]["fields"] == {"title": "Widgets"}


def test_non_json_metadata_rejected():
    doc = _doc(metadata={"created": object()})
    with pytest.raises(ValueError, match="JSON-compatible"):
        build_index_documents([doc], field_definitions=_fields())


def test_non_finite_metadata_float_rejected():
    doc = _doc(metadata={"score": float("inf")})
    with pytest.raises(ValueError, match="not finite"):
        build_index_documents([doc], field_definitions=_fields())


def test_non_string_metadata_key_rejected():
    doc = _doc(metadata={1: "x"})
    with pytest.raises(ValueError, match="non-string metadata key"):
        build_index_documents([doc], field_definitions=_fields())


def test_negative_document_boost_rejected():
    doc = _doc(boost=-1.0)
    with pytest.raises(ValueError, match="boost"):
        build_index_documents([doc], field_definitions=_fields())


def test_bool_document_boost_rejected():
    doc = _doc(boost=True)
    with pytest.raises(ValueError, match="boost"):
        build_index_documents([doc], field_definitions=_fields())


def test_empty_language_rejected():
    doc = _doc(language="")
    with pytest.raises(ValueError, match="language"):
        build_index_documents([doc], field_definitions=_fields())


def test_multi_field_indexing_with_different_boosts():
    doc = _doc(
        indexed_fields={"title": "Widgets", "body": "widgets are great and useful"},
        stored_fields={"title": "Widgets"},
    )
    built = build_index_documents([doc], field_definitions=_fields())
    assert built.manifest["fields"]["title"] == {"indexed": True, "stored": True, "boost": 3.0}
    assert built.manifest["fields"]["body"] == {"indexed": True, "stored": False, "boost": 1.0}
    assert built.manifest["fields"]["excerpt"] == {"indexed": False, "stored": True}
    posting = built.term_shards["en"]["widget"]["postings"][0]
    assert "title" in posting["fields"]
    assert "body" in posting["fields"]


def test_indexed_and_stored_values_may_differ_for_same_field_name():
    doc = _doc(
        indexed_fields={"title": "normalized widgets", "body": "widgets are great"},
        stored_fields={"title": "Widgets (Presentation Case)"},
    )
    built = build_index_documents([doc], field_definitions=_fields())
    assert built.doc_store["1"]["fields"]["title"] == "Widgets (Presentation Case)"
    assert "normal" in built.term_shards["en"]


def test_arbitrary_stored_fields():
    fields = _fields(
        heading=FieldDefinition(indexed=False, stored=True),
        source_path=FieldDefinition(indexed=False, stored=True),
    )
    doc = _doc(
        stored_fields={
            "title": "Widgets", "excerpt": "e",
            "heading": "Overview", "source_path": "docs/widgets.md",
        }
    )
    built = build_index_documents([doc], field_definitions=fields)
    assert built.doc_store["1"]["fields"]["heading"] == "Overview"
    assert built.doc_store["1"]["fields"]["source_path"] == "docs/widgets.md"


def test_external_id_round_trip():
    doc = _doc(external_id="docs/compiler.md#typescript-output")
    built = build_index_documents([doc], field_definitions=_fields())
    assert built.doc_store["1"]["externalId"] == "docs/compiler.md#typescript-output"


def test_external_id_omitted_when_none():
    built = build_index_documents([_doc()], field_definitions=_fields())
    assert "externalId" not in built.doc_store["1"]


def test_metadata_round_trip():
    metadata = {"sourcePath": "docs/widgets.md", "headingPath": ["Widgets"], "chunkIndex": 3}
    doc = _doc(metadata=metadata)
    built = build_index_documents([doc], field_definitions=_fields())
    assert built.doc_store["1"]["metadata"] == metadata


def test_metadata_omitted_when_empty():
    built = build_index_documents([_doc()], field_definitions=_fields())
    assert "metadata" not in built.doc_store["1"]


def test_content_hash_present_and_boost_omitted_when_default():
    built = build_index_documents([_doc()], field_definitions=_fields())
    entry = built.doc_store["1"]
    assert entry["contentHash"].startswith("sha256:")
    assert "boost" not in entry


def test_document_boost_included_when_not_default():
    built = build_index_documents([_doc(boost=2.0)], field_definitions=_fields())
    assert built.doc_store["1"]["boost"] == 2.0


def test_built_index_is_marked_structured():
    built = build_index_documents([_doc()], field_definitions=_fields())
    assert built.structured is True


def test_avg_field_length_includes_every_indexed_field_zero_filled():
    # "body" only present on doc 2 -- doc 1's contribution to "body" avg must be 0,
    # not excluded from the average's denominator.
    docs = [
        _doc(doc_id=1, indexed_fields={"title": "Widgets"}, stored_fields={}),
        _doc(doc_id=2, indexed_fields={"title": "Sofas", "body": "sofas sofas"}, stored_fields={}),
    ]
    built = build_index_documents(docs, field_definitions=_fields())
    avg = built.manifest["avgFieldLength"]["en"]
    assert avg["body"] == pytest.approx(1.0)  # (0 + 2) / 2 docs


def test_mutating_caller_document_after_build_does_not_affect_result():
    indexed_fields = {"title": "Widgets", "body": "widgets are great"}
    metadata = {"tags": ["a"]}
    doc = _doc(indexed_fields=indexed_fields, metadata=metadata)
    built = build_index_documents([doc], field_definitions=_fields())
    indexed_fields["title"] = "MUTATED"
    metadata["tags"].append("b")
    assert built.doc_store["1"]["fields"].get("title", "Widgets") != "MUTATED"
    assert built.doc_store["1"].get("metadata", {"tags": ["a"]})["tags"] == ["a"]


def test_mutating_caller_field_definitions_after_build_does_not_affect_result():
    fields = _fields()
    built = build_index_documents([_doc()], field_definitions=fields)
    fields["title"] = FieldDefinition(indexed=False, stored=False)
    assert built.manifest["fields"]["title"]["indexed"] is True


def test_documents_iterable_is_consumed_fully_generators_supported():
    def gen():
        yield _doc(doc_id=1)
        yield _doc(doc_id=2)

    built = build_index_documents(gen(), field_definitions=_fields())
    assert set(built.doc_store.keys()) == {"1", "2"}


def test_same_documents_in_different_order_produce_identical_output():
    docs_a = [_doc(doc_id=1), _doc(doc_id=2)]
    docs_b = [_doc(doc_id=2), _doc(doc_id=1)]
    built_a = build_index_documents(docs_a, field_definitions=_fields())
    built_b = build_index_documents(docs_b, field_definitions=_fields())
    assert built_a.doc_store == built_b.doc_store
    assert built_a.term_shards == built_b.term_shards
    assert built_a.manifest["docCount"] == built_b.manifest["docCount"]
    assert built_a.manifest["avgFieldLength"] == built_b.manifest["avgFieldLength"]
