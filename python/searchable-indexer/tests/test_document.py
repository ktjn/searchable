from searchable_indexer.document import FieldDefinition, IndexDocument, compute_content_hash


def test_field_definition_defaults():
    definition = FieldDefinition()
    assert definition.indexed is True
    assert definition.stored is False
    assert definition.boost == 1.0


def test_field_definition_is_frozen():
    definition = FieldDefinition()
    try:
        definition.boost = 2.0
        assert False, "expected FrozenInstanceError"
    except Exception as exc:
        assert type(exc).__name__ == "FrozenInstanceError"


def test_index_document_defaults():
    document = IndexDocument(id=1)
    assert document.external_id is None
    assert document.url == ""
    assert document.language == "en"
    assert document.indexed_fields == {}
    assert document.stored_fields == {}
    assert document.metadata == {}
    assert document.boost == 1.0


def _doc(**overrides) -> IndexDocument:
    base = dict(
        id=1,
        indexed_fields={"body": "widgets are great"},
        stored_fields={"title": "Widgets"},
        metadata={"chunkIndex": 3},
        language="en",
        boost=1.0,
    )
    base.update(overrides)
    return IndexDocument(**base)


def test_content_hash_is_deterministic():
    assert compute_content_hash(_doc()) == compute_content_hash(_doc())


def test_content_hash_ignores_dict_insertion_order():
    a = _doc(indexed_fields={"body": "x", "title": "y"})
    b = _doc(indexed_fields={"title": "y", "body": "x"})
    assert compute_content_hash(a) == compute_content_hash(b)


def test_content_hash_changes_with_content():
    assert compute_content_hash(_doc()) != compute_content_hash(_doc(boost=2.0))
    assert compute_content_hash(_doc()) != compute_content_hash(
        _doc(indexed_fields={"body": "different"})
    )
    assert compute_content_hash(_doc()) != compute_content_hash(
        _doc(metadata={"chunkIndex": 4})
    )


def test_content_hash_ignores_id_and_external_id_and_url():
    a = IndexDocument(id=1, external_id="a", url="/a", indexed_fields={"body": "x"})
    b = IndexDocument(id=2, external_id="b", url="/b", indexed_fields={"body": "x"})
    assert compute_content_hash(a) == compute_content_hash(b)


def test_content_hash_is_prefixed_sha256():
    digest = compute_content_hash(_doc())
    assert digest.startswith("sha256:")
    assert len(digest) == len("sha256:") + 64
