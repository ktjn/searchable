import pytest

from searchable.indexer.build_index import build_index
from searchable.indexer.types import SourceDocument


def _doc(doc_id: int, url: str, title: str, body: str, lang: str = "en") -> SourceDocument:
    html = (
        f'<html lang="{lang}"><head><title>{title}</title></head>'
        f"<body><main>{body}</main></body></html>"
    )
    return SourceDocument(id=doc_id, url=url, html=html)


def test_indexes_title_and_body_terms_with_postings():
    sources = [_doc(1, "/widgets", "Widgets", "Our widgets are wonderful.")]
    built = build_index(sources)
    en_shard = built.term_shards["en"]
    assert "widget" in en_shard
    entry = en_shard["widget"]
    assert entry["df"] == 1
    posting = entry["postings"][0]
    assert posting["doc"] == 1
    assert posting["fields"]["title"]["tf"] == 1
    assert posting["fields"]["body"]["tf"] == 1


def test_postings_are_sorted_by_doc_id():
    sources = [
        _doc(3, "/c", "Widgets", "widgets"),
        _doc(1, "/a", "Widgets", "widgets"),
        _doc(2, "/b", "Widgets", "widgets"),
    ]
    built = build_index(sources)
    doc_ids = [p["doc"] for p in built.term_shards["en"]["widget"]["postings"]]
    assert doc_ids == [1, 2, 3]


def test_doc_store_holds_url_title_and_excerpt():
    sources = [_doc(1, "/widgets", "Widgets", "Our widgets are wonderful and useful for everyone.")]
    built = build_index(sources)
    entry = built.doc_store["1"]
    assert entry["url"] == "/widgets"
    assert entry["fields"]["title"] == "Widgets"
    assert "wonderful" in entry["fields"]["excerpt"]
    assert "body" not in entry["fields"]


def test_noindex_documents_are_skipped():
    html = (
        '<html lang="en"><head><title>T</title>'
        '<meta name="searchable-noindex" content="true"></head>'
        "<body><main>Content</main></body></html>"
    )
    sources = [SourceDocument(id=1, url="/hidden", html=html)]
    built = build_index(sources)
    assert built.doc_store == {}
    assert built.term_shards == {}


def test_field_boosts_default_to_title_3_body_1():
    built = build_index([_doc(1, "/a", "T", "b")])
    assert built.manifest["fields"]["title"]["boost"] == 3.0
    assert built.manifest["fields"]["body"]["boost"] == 1.0


def test_field_boosts_can_be_overridden():
    built = build_index([_doc(1, "/a", "T", "b")], field_boosts={"title": 5.0})
    assert built.manifest["fields"]["title"]["boost"] == 5.0
    assert built.manifest["fields"]["body"]["boost"] == 1.0


def test_multi_language_corpus_gets_a_shard_per_language():
    sources = [
        _doc(1, "/en", "Widgets", "widgets", lang="en"),
        _doc(2, "/de", "Sofas", "sofas sind bequem", lang="de"),
    ]
    built = build_index(sources)
    assert set(built.term_shards.keys()) == {"en", "de"}
    assert built.manifest["languages"] == ["de", "en"]


def test_id_range_covers_min_and_max_indexed_ids():
    sources = [_doc(5, "/a", "T", "b"), _doc(1, "/b", "T", "b"), _doc(3, "/c", "T", "b")]
    built = build_index(sources)
    assert built.id_range == (1, 5)


def test_duplicate_ids_raise_value_error():
    sources = [_doc(1, "/a", "T", "b"), _doc(1, "/b", "T", "b")]
    with pytest.raises(ValueError, match="duplicate document id"):
        build_index(sources)


def test_negative_id_raises_value_error():
    sources = [_doc(-1, "/a", "T", "b")]
    with pytest.raises(ValueError, match="invalid document id"):
        build_index(sources)


def test_manifest_shape_matches_the_json_schema_expectations():
    built = build_index([_doc(1, "/a", "Widgets", "widgets are great")])
    manifest = built.manifest
    assert manifest["version"] == 2
    assert manifest["defaultLanguage"] == "en"
    assert manifest["docCount"]["en"] == 1
    assert manifest["avgFieldLength"]["en"]["title"] > 0
    assert manifest["shards"] == {"terms": [], "docs": []}


def _doc_with_meta(
    doc_id: int, url: str, title: str, body: str, extra_head: str = ""
) -> SourceDocument:
    html = (
        f'<html lang="en"><head><title>{title}</title>{extra_head}</head>'
        f"<body><main>{body}</main></body></html>"
    )
    return SourceDocument(id=doc_id, url=url, html=html)


def test_terms_facets_are_indexed_from_searchable_facet_meta_tags():
    doc = _doc_with_meta(
        1,
        "/a",
        "Widgets",
        "widgets",
        extra_head='<meta name="searchable-facet-color" content="red">',
    )
    built = build_index([doc])
    assert built.facet_shards["color"]["type"] == "terms"
    assert built.facet_shards["color"]["values"]["red"]["docs"] == [1]


def test_hierarchical_facets_option_produces_hierarchy_shard():
    doc = _doc_with_meta(
        1,
        "/a",
        "Widgets",
        "widgets",
        extra_head='<meta name="searchable-facet-category" content="a>b">',
    )
    built = build_index([doc], hierarchical_facets={"category": {}})
    assert built.facet_shards["category"]["type"] == "hierarchy"
    assert "a" in built.facet_shards["category"]["values"]
    assert "a>b" in built.facet_shards["category"]["values"]


def test_range_facets_get_default_5_equal_width_buckets():
    docs = [
        _doc_with_meta(
            i,
            f"/d{i}",
            "T",
            "b",
            extra_head=f'<meta name="searchable-facet-range-price" content="{price}">',
        )
        for i, price in enumerate([10, 50, 90], start=1)
    ]
    built = build_index(docs)
    assert built.facet_shards["price"]["type"] == "range"
    assert len(built.facet_shards["price"]["values"]) <= 5


def test_range_facet_buckets_option_overrides_default_count():
    docs = [
        _doc_with_meta(
            i,
            f"/d{i}",
            "T",
            "b",
            extra_head=f'<meta name="searchable-facet-range-price" content="{price}">',
        )
        for i, price in enumerate([10, 50, 90], start=1)
    ]
    built = build_index(docs, range_facet_buckets={"price": 2})
    assert len(built.facet_shards["price"]["values"]) == 2


def test_invalid_range_facet_buckets_count_raises_value_error():
    doc = _doc_with_meta(1, "/a", "T", "b")
    with pytest.raises(ValueError, match="invalid range_facet_buckets count"):
        build_index([doc], range_facet_buckets={"price": 0})


def test_invalid_range_facet_buckets_boundaries_raises_value_error():
    doc = _doc_with_meta(1, "/a", "T", "b")
    with pytest.raises(ValueError, match="must be strictly ascending"):
        build_index([doc], range_facet_buckets={"price": [50, 25]})


def test_manifest_facet_fields_present_only_when_facets_exist():
    doc = _doc_with_meta(1, "/a", "T", "b")
    built = build_index([doc])
    assert "facetFields" not in built.manifest

    doc2 = _doc_with_meta(
        1,
        "/a",
        "T",
        "b",
        extra_head='<meta name="searchable-facet-color" content="red">',
    )
    built2 = build_index([doc2])
    assert built2.manifest["facetFields"] == ["color"]


def test_pins_are_accumulated_and_resolved():
    doc = _doc_with_meta(
        1,
        "/a",
        "Widgets",
        "widgets are great",
        extra_head='<meta name="searchable-pin" content="widgets">',
    )
    built = build_index([doc])
    assert "widget" in built.pins_shards["en"]
    assert built.pins_shards["en"]["widget"]["docs"][0]["id"] == 1


def test_pin_conflict_prints_a_warning_to_stderr(capsys):
    doc1 = _doc_with_meta(
        1, "/a", "T", "b", extra_head='<meta name="searchable-pin" content="widgets">'
    )
    doc2 = _doc_with_meta(
        2, "/b", "T", "b", extra_head='<meta name="searchable-pin" content="widgets">'
    )
    build_index([doc1, doc2])
    captured = capsys.readouterr()
    assert "pin conflict" in captured.err


def test_synonyms_option_populates_synonym_shards():
    doc = _doc_with_meta(1, "/a", "T", "b")
    built = build_index([doc], synonyms={"en": {"equivalences": [["Couch", "Sofa"]]}})
    assert built.synonym_shards["en"]["equivalences"] == [["couch", "sofa"]]


def test_fuzzy_false_by_default_produces_no_fuzzy_shards():
    doc = _doc_with_meta(1, "/a", "Widgets", "widgets")
    built = build_index([doc])
    assert built.fuzzy_shards == {}


def test_fuzzy_true_produces_a_deletion_dictionary_per_language():
    doc = _doc_with_meta(1, "/a", "Widgets", "widgets")
    built = build_index([doc], fuzzy=True)
    assert built.fuzzy_shards["en"]["maxEdits"] == 1
    assert "widget" in built.fuzzy_shards["en"]["deletions"]


def test_invalid_fuzzy_max_edits_raises_value_error():
    doc = _doc_with_meta(1, "/a", "T", "b")
    with pytest.raises(ValueError, match="invalid fuzzy_max_edits"):
        build_index([doc], fuzzy=True, fuzzy_max_edits=3)
