import json
from pathlib import Path

from searchable.indexer.build_index import build_index, build_index_documents
from searchable.indexer.document import FieldDefinition, IndexDocument
from searchable.indexer.types import SourceDocument
from searchable.indexer.write_index import write_index


def _doc(doc_id: int, url: str, title: str, body: str) -> SourceDocument:
    html = (
        f'<html lang="en"><head><title>{title}</title></head>'
        f"<body><main>{body}</main></body></html>"
    )
    return SourceDocument(id=doc_id, url=url, html=html)


def test_writes_manifest_json_and_it_is_valid_json(tmp_path: Path):
    built = build_index([_doc(1, "/a", "Widgets", "widgets are great")])
    write_index(built, str(tmp_path))
    manifest_path = tmp_path / "manifest.json"
    assert manifest_path.exists()
    manifest = json.loads(manifest_path.read_text())
    assert manifest["version"] == 2
    assert manifest["shards"]["terms"]
    assert manifest["shards"]["docs"]


def test_term_shard_files_are_content_hashed_and_readable(tmp_path: Path):
    built = build_index([_doc(1, "/a", "Widgets", "widgets are great")])
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    terms = manifest["shards"]["terms"]
    # Body text "widgets are great" indexes "widget", "ar" (stem of "are"),
    # and "great" as separate single-character prefix shards ("w", "a",
    # "g") since neither language profile has a stopword list configured
    # -- pick the shard for the "widget" prefix rather than assuming
    # shards[0], since alphabetical shard order ("a" < "g" < "w") doesn't
    # put "widget" first.
    term_entry = next(entry for entry in terms if entry["prefix"] == "w")
    assert term_entry["lang"] == "en"
    term_file = tmp_path / term_entry["file"]
    assert term_file.exists()
    assert "." in term_entry["file"].removesuffix(".json")  # hash segment present
    term_shard = json.loads(term_file.read_text())
    assert "widget" in term_shard


def test_doc_store_file_is_written_and_readable(tmp_path: Path):
    built = build_index([_doc(1, "/a", "Widgets", "widgets are great")])
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    docs_entry = manifest["shards"]["docs"][0]
    assert docs_entry["idRange"] == [1, 1]
    docs_file = tmp_path / docs_entry["file"]
    doc_store = json.loads(docs_file.read_text())
    assert doc_store["1"]["url"] == "/a"


def test_structured_doc_store_can_be_written(tmp_path: Path):
    built = build_index_documents(
        [
            IndexDocument(
                id=7,
                external_id="chunk-7",
                url="/chunks/7",
                indexed_fields={"body": "structured chunk"},
                stored_fields={"title": "Chunk 7"},
                metadata={"chunkIndex": 7},
            )
        ],
        field_definitions={
            "body": FieldDefinition(indexed=True),
            "title": FieldDefinition(indexed=False, stored=True),
        },
    )

    write_index(built, str(tmp_path))

    manifest = json.loads((tmp_path / "manifest.json").read_text())
    docs_entry = manifest["shards"]["docs"][0]
    assert docs_entry["file"].endswith(".json")


def test_shard_by_prefix_false_writes_one_shard_named_all(tmp_path: Path):
    built = build_index([_doc(1, "/a", "Widgets", "widgets and gadgets")])
    write_index(built, str(tmp_path), shard_by_prefix=False)
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    terms = manifest["shards"]["terms"]
    assert len(terms) == 1
    assert terms[0]["prefix"] == "all"


def test_empty_corpus_still_writes_one_empty_doc_store_shard(tmp_path: Path):
    built = build_index([])
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert len(manifest["shards"]["docs"]) == 1
    docs_file = tmp_path / manifest["shards"]["docs"][0]["file"]
    assert json.loads(docs_file.read_text()) == {}


def test_output_is_byte_identical_across_repeated_builds_of_the_same_corpus(tmp_path: Path):
    sources = [_doc(1, "/a", "Widgets", "widgets"), _doc(2, "/b", "Gadgets", "gadgets")]
    out1, out2 = tmp_path / "out1", tmp_path / "out2"
    write_index(build_index(sources), str(out1))
    write_index(build_index(sources), str(out2))
    # buildId is a timestamp, so compare everything except that one field.
    m1 = json.loads((out1 / "manifest.json").read_text())
    m2 = json.loads((out2 / "manifest.json").read_text())
    m1.pop("buildId")
    m2.pop("buildId")
    assert m1 == m2


def _doc_with_meta(doc_id, url, title, body, extra_head=""):
    html = (
        f'<html lang="en"><head><title>{title}</title>{extra_head}</head>'
        f"<body><main>{body}</main></body></html>"
    )
    return SourceDocument(id=doc_id, url=url, html=html)


def test_facet_shard_is_written_and_referenced_in_manifest(tmp_path):
    doc = _doc_with_meta(
        1, "/a", "T", "b", extra_head='<meta name="searchable-facet-color" content="red">'
    )
    built = build_index([doc])
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["facetFields"] == ["color"]
    facets_entry = manifest["shards"]["facets"][0]
    assert facets_entry["field"] == "color"
    facet_shard = json.loads((tmp_path / facets_entry["file"]).read_text())
    assert facet_shard["values"]["red"]["docs"] == [1]


def test_no_facets_section_when_no_facets_present(tmp_path):
    doc = _doc_with_meta(1, "/a", "T", "b")
    built = build_index([doc])
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert "facets" not in manifest["shards"]
    assert "facetFields" not in manifest


def test_pins_shard_is_written_and_referenced_in_manifest(tmp_path):
    doc = _doc_with_meta(
        1, "/a", "Widgets", "widgets", extra_head='<meta name="searchable-pin" content="widgets">'
    )
    built = build_index([doc])
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    pins_file = manifest["pins"]["en"]
    pins_shard = json.loads((tmp_path / pins_file).read_text())
    assert "widget" in pins_shard


def test_synonym_shard_is_written_and_referenced_in_manifest(tmp_path):
    doc = _doc_with_meta(1, "/a", "T", "b")
    built = build_index([doc], synonyms={"en": {"equivalences": [["Couch", "Sofa"]]}})
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    synonyms_file = manifest["synonyms"]["en"]
    synonym_shard = json.loads((tmp_path / synonyms_file).read_text())
    assert synonym_shard["equivalences"] == [["couch", "sofa"]]


def test_fuzzy_shard_is_written_and_referenced_in_manifest(tmp_path):
    doc = _doc_with_meta(1, "/a", "Widgets", "widgets")
    built = build_index([doc], fuzzy=True)
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    fuzzy_entry = manifest["fuzzy"]["en"]
    fuzzy_shard = json.loads((tmp_path / fuzzy_entry["file"]).read_text())
    assert fuzzy_shard["maxEdits"] == 1


def test_no_pins_synonyms_fuzzy_sections_when_none_configured(tmp_path):
    doc = _doc_with_meta(1, "/a", "T", "b")
    built = build_index([doc])
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert "pins" not in manifest
    assert "synonyms" not in manifest
    assert "fuzzy" not in manifest


def test_shard_files_are_json_by_default(tmp_path):
    built = build_index([_doc(1, "/a", "Widgets", "widgets are great")], fuzzy=True)
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["shards"]["terms"][0]["file"].endswith(".json")
    assert manifest["shards"]["docs"][0]["file"].endswith(".json")
    assert manifest["fuzzy"]["en"]["file"].endswith(".json")
