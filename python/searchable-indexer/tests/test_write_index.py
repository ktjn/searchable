import json
from pathlib import Path

import pytest

from searchable_indexer.build_index import build_index, build_index_documents
from searchable_indexer.document import FieldDefinition, IndexDocument
from searchable_indexer.types import BuiltIndex, SourceDocument
from searchable_indexer.write_index import write_index


def _doc(doc_id: int, url: str, title: str, body: str) -> SourceDocument:
    html = f'<html lang="en"><head><title>{title}</title></head><body><main>{body}</main></body></html>'
    return SourceDocument(id=doc_id, url=url, html=html)


def test_writes_manifest_json_and_it_is_valid_json(tmp_path: Path):
    built = build_index([_doc(1, "/a", "Widgets", "widgets are great")])
    write_index(built, str(tmp_path))
    manifest_path = tmp_path / "manifest.json"
    assert manifest_path.exists()
    manifest = json.loads(manifest_path.read_text())
    assert manifest["version"] == 1
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


def test_write_index_rejects_vector_shards_with_mismatched_dims_across_languages(
    tmp_path: Path,
):
    # Bypasses build_vector_shards' own dims check to prove write_index has
    # an independent, defense-in-depth assertion of its own.
    built = BuiltIndex(
        manifest={
            "version": 1,
            "buildId": "test",
            "format": "json",
            "languages": ["en", "de"],
            "defaultLanguage": "en",
            "fields": {},
            "docCount": {},
            "avgFieldLength": {},
            "shards": {"terms": [], "docs": []},
        },
        term_shards={},
        doc_store={},
        id_range=(1, 2),
        vector_shards={
            "en": {
                "dims": 2,
                "quantization": "float32",
                "entries": [{"passageId": "1-0", "docId": 1, "vector": [1.0, 2.0]}],
            },
            "de": {
                "dims": 3,
                "quantization": "float32",
                "entries": [{"passageId": "2-0", "docId": 2, "vector": [1.0, 2.0, 3.0]}],
            },
        },
        embedding_provider={"type": "custom"},
    )
    with pytest.raises(ValueError, match="dimension"):
        write_index(built, str(tmp_path))


def test_vector_shards_are_written_and_manifest_records_them(tmp_path: Path):
    def embed(texts: list[str]) -> list[list[float]]:
        return [[float(len(t)), 0.0] for t in texts]

    built = build_index(
        [_doc(1, "/a", "Widgets", "widgets are great")],
        embed=embed,
        embedding_provider={"type": "custom"},
        vector_quantization="float32",
    )
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())

    assert manifest["vectors"]["dims"] == 2
    assert manifest["vectors"]["quantization"] == "float32"
    assert manifest["vectors"]["embeddingProvider"] == {"type": "custom"}
    shard_file = manifest["vectors"]["shards"]["en"]
    shard = json.loads((tmp_path / shard_file).read_text())
    assert shard["entries"][0]["docId"] == 1


def test_structured_vectors_preserve_document_store_fields(tmp_path: Path):
    def embed(texts: list[str]) -> list[list[float]]:
        return [[float(len(texts[0])), 0.0]]

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
        embed=embed,
        embedding_provider={"type": "test"},
        vector_field="body",
        vector_quantization="float32",
    )
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())

    assert manifest["vectors"]["dims"] == 2
    assert manifest["vectors"]["quantization"] == "float32"
    assert manifest["vectors"]["embeddingProvider"] == {"type": "test"}
    vector_shard = json.loads(
        (tmp_path / manifest["vectors"]["shards"]["en"]).read_text()
    )
    assert vector_shard["entries"][0]["docId"] == 7

    doc_shard = json.loads(
        (tmp_path / manifest["shards"]["docs"][0]["file"]).read_text()
    )
    entry = doc_shard["7"]
    assert entry["externalId"] == "chunk-7"
    assert entry["metadata"] == {"chunkIndex": 7}
    assert entry["contentHash"].startswith("sha256:")


def test_legacy_html_vectors_still_use_sliding_windows():
    words = " ".join(f"word{i}" for i in range(25))

    built = build_index(
        [_doc(1, "/long", "Long document", words)],
        embed=lambda texts: [[float(len(texts[0])), 0.0] for _ in texts],
        embedding_provider={"type": "test"},
        vector_quantization="float32",
        vector_window=10,
        vector_overlap=2,
    )

    assert [entry["passageId"] for entry in built.vector_shards["en"]["entries"]] == [
        "1-0",
        "1-1",
        "1-2",
    ]


def test_no_embed_means_no_vectors_key_in_manifest(tmp_path: Path):
    built = build_index([_doc(1, "/a", "Widgets", "widgets are great")])
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert "vectors" not in manifest


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


def test_term_shard_format_binary_writes_bin_files_and_marks_manifest(tmp_path):
    built = build_index([_doc(1, "/a", "Widgets", "widgets are great")])
    write_index(built, str(tmp_path), term_shard_format="binary")
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    term_entry = manifest["shards"]["terms"][0]
    assert term_entry["format"] == "binary"
    assert term_entry["file"].endswith(".bin")
    term_file = tmp_path / term_entry["file"]
    assert term_file.exists()
    # Binary content must not parse as JSON.
    try:
        json.loads(term_file.read_bytes())
        parsed_as_json = True
    except (json.JSONDecodeError, UnicodeDecodeError):
        parsed_as_json = False
    assert not parsed_as_json


def test_doc_store_format_binary_writes_bin_files_and_marks_manifest(tmp_path):
    built = build_index([_doc(1, "/a", "Widgets", "widgets are great")])
    write_index(built, str(tmp_path), doc_store_format="binary")
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    docs_entry = manifest["shards"]["docs"][0]
    assert docs_entry["format"] == "binary"
    assert docs_entry["file"].endswith(".bin")
    assert (tmp_path / docs_entry["file"]).exists()


def test_fuzzy_shard_format_binary_writes_bin_files_and_marks_manifest(tmp_path):
    built = build_index([_doc(1, "/a", "Widgets", "widgets are great")], fuzzy=True)
    write_index(built, str(tmp_path), fuzzy_shard_format="binary")
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    fuzzy_entry = manifest["fuzzy"]["en"]
    assert fuzzy_entry["format"] == "binary"
    assert fuzzy_entry["file"].endswith(".bin")
    assert (tmp_path / fuzzy_entry["file"]).exists()


def test_default_format_is_still_json_for_all_three(tmp_path):
    built = build_index([_doc(1, "/a", "Widgets", "widgets are great")], fuzzy=True)
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert "format" not in manifest["shards"]["terms"][0]
    assert "format" not in manifest["shards"]["docs"][0]
    assert "format" not in manifest["fuzzy"]["en"]


def test_binary_term_shard_content_hash_matches_file_bytes(tmp_path):
    from searchable_indexer.hash import content_hash

    built = build_index([_doc(1, "/a", "Widgets", "widgets are great")])
    write_index(built, str(tmp_path), term_shard_format="binary")
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    term_entry = manifest["shards"]["terms"][0]
    file_bytes = (tmp_path / term_entry["file"]).read_bytes()
    assert content_hash(file_bytes) in term_entry["file"]


def test_binary_doc_store_rejected_for_structured_index(tmp_path):
    from searchable_indexer.build_index import build_index_documents
    from searchable_indexer.document import FieldDefinition, IndexDocument

    doc = IndexDocument(id=1, indexed_fields={"body": "widgets are great"})
    built = build_index_documents(
        [doc], field_definitions={"body": FieldDefinition(indexed=True, stored=False)}
    )
    with pytest.raises(ValueError, match="binary"):
        write_index(built, str(tmp_path), doc_store_format="binary")


def test_binary_doc_store_still_allowed_for_legacy_index(tmp_path):
    sources = [
        SourceDocument(
            id=1, url="/a",
            html="<html><head><title>Widgets</title></head>"
                 "<body><main>widgets are great</main></body></html>",
        )
    ]
    built = build_index(sources)
    write_index(built, str(tmp_path), doc_store_format="binary")
    assert (tmp_path / "manifest.json").exists()
