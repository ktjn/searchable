import json

from searchable_indexer.build_index import build_index
from searchable_indexer.types import SourceDocument
from searchable_indexer.write_index import write_index


def _sources() -> list[SourceDocument]:
    return [
        SourceDocument(
            id=1,
            url="/widgets",
            html='<html lang="en"><head><title>Widgets</title>'
            '<meta name="searchable-boost" content="2.0">'
            '<meta name="searchable-facet-category" content="tools">'
            "</head><body><main>Our widgets are wonderful and useful for "
            "everyone who needs them.</main></body></html>",
        ),
        SourceDocument(
            id=2,
            url="/sofas",
            html='<html lang="de"><head><title>Sofas</title></head>'
            "<body><main>Unsere Sofas sind sehr bequem und günstig.</main>"
            "</body></html>",
        ),
    ]


def test_legacy_doc_store_and_term_shards_match_expected_shape(tmp_path):
    built = build_index(_sources())

    assert built.doc_store["1"]["url"] == "/widgets"
    assert built.doc_store["1"]["fields"]["title"] == "Widgets"
    assert "wonderful" in built.doc_store["1"]["fields"]["excerpt"]
    assert built.doc_store["1"]["boost"] == 2.0
    assert "externalId" not in built.doc_store["1"]
    assert "metadata" not in built.doc_store["1"]
    assert "contentHash" not in built.doc_store["1"]
    assert built.structured is False

    en_widget = built.term_shards["en"]["widget"]
    assert en_widget["postings"][0]["fields"]["title"]["tf"] == 1
    assert en_widget["postings"][0]["fields"]["body"]["tf"] == 1

    assert built.manifest["fields"]["title"] == {"indexed": True, "stored": True, "boost": 3.0}
    assert built.manifest["fields"]["body"] == {"indexed": True, "stored": False, "boost": 1.0}
    assert built.manifest["fields"]["excerpt"] == {"indexed": False, "stored": True}
    assert set(built.manifest["avgFieldLength"]["en"].keys()) == {"title", "body"}

    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert "indexed" in manifest["fields"]["title"]
    assert "excerpt" in manifest["fields"]


def test_legacy_ranking_is_unaffected_by_dynamic_field_loop():
    # Same query-relevant assertions as test_build_index.py, re-checked here to
    # guard the postings-loop generalization specifically.
    sources = [
        SourceDocument(
            id=1,
            url="/a",
            html="<html><head><title>Widgets</title></head>"
            "<body><main>widgets widgets widgets</main></body></html>",
        ),
        SourceDocument(
            id=2,
            url="/b",
            html="<html><head><title>Other</title></head><body><main>widgets</main></body></html>",
        ),
    ]
    built = build_index(sources)
    entry = built.term_shards["en"]["widget"]
    assert entry["df"] == 2
    by_doc = {p["doc"]: p for p in entry["postings"]}
    assert by_doc[1]["fields"]["body"]["tf"] == 3
    assert by_doc[2]["fields"]["body"]["tf"] == 1
