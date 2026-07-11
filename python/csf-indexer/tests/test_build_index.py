import pytest

from csf_indexer.build_index import build_index
from csf_indexer.types import SourceDocument


def _doc(doc_id: int, url: str, title: str, body: str, lang: str = "en") -> SourceDocument:
    html = f'<html lang="{lang}"><head><title>{title}</title></head><body><main>{body}</main></body></html>'
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
    html = '<html lang="en"><head><title>T</title><meta name="csf-noindex" content="true"></head><body><main>Content</main></body></html>'
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
    assert manifest["version"] == 1
    assert manifest["format"] == "json"
    assert manifest["defaultLanguage"] == "en"
    assert manifest["docCount"]["en"] == 1
    assert manifest["avgFieldLength"]["en"]["title"] > 0
    assert manifest["shards"] == {"terms": [], "docs": []}
