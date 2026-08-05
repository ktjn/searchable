import json
from pathlib import Path

import jsonschema

from searchable_indexer.build_index import build_index
from searchable_indexer.types import SourceDocument
from searchable_indexer.write_index import write_index

_REPO_ROOT = Path(__file__).resolve().parents[3]
_SCHEMA_DIR = _REPO_ROOT / "spec" / "schema"


def _load_schema(name: str) -> dict:
    return json.loads((_SCHEMA_DIR / name).read_text())


def test_schema_ids_use_the_searchable_repository():
    prefix = "https://raw.githubusercontent.com/ktjn/searchable/main/spec/schema/"
    for path in _SCHEMA_DIR.glob("*.schema.json"):
        assert _load_schema(path.name)["$id"] == f"{prefix}{path.name}"


def _doc(doc_id: int, url: str, title: str, body: str, lang: str = "en") -> SourceDocument:
    html = (
        f'<html lang="{lang}"><head><title>{title}</title></head>'
        f"<body><main>{body}</main></body></html>"
    )
    return SourceDocument(id=doc_id, url=url, html=html)


def test_manifest_validates_against_manifest_schema(tmp_path):
    sources = [
        _doc(1, "/a", "Widgets", "Our widgets are wonderful and useful."),
        _doc(2, "/b", "Sofas", "Unsere Sofas sind sehr bequem.", lang="de"),
    ]
    built = build_index(sources)
    write_index(built, str(tmp_path))

    manifest = json.loads((tmp_path / "manifest.json").read_text())
    schema = _load_schema("manifest.schema.json")
    jsonschema.validate(instance=manifest, schema=schema)


def test_term_shard_validates_against_term_shard_schema(tmp_path):
    built = build_index([_doc(1, "/a", "Widgets", "widgets are great and useful")])
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())

    schema = _load_schema("term-shard.schema.json")
    for term_entry in manifest["shards"]["terms"]:
        term_shard = json.loads((tmp_path / term_entry["file"]).read_text())
        jsonschema.validate(instance=term_shard, schema=schema)


def test_doc_store_shard_validates_against_doc_store_shard_schema(tmp_path):
    built = build_index([_doc(1, "/a", "Widgets", "widgets are great")])
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())

    schema = _load_schema("doc-store-shard.schema.json")
    for docs_entry in manifest["shards"]["docs"]:
        doc_store_shard = json.loads((tmp_path / docs_entry["file"]).read_text())
        jsonschema.validate(instance=doc_store_shard, schema=schema)


def test_facet_shard_validates_against_facet_shard_schema(tmp_path):
    docs = [
        SourceDocument(
            id=1,
            url="/a",
            html='<html lang="en"><head><title>T</title>'
            '<meta name="searchable-facet-category" content="a>b">'
            '<meta name="searchable-facet-range-price" content="19.99">'
            "</head><body><main>widgets are great</main></body></html>",
        ),
    ]
    built = build_index(docs, hierarchical_facets={"category": {}})
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())

    schema = _load_schema("facet-shard.schema.json")
    for facets_entry in manifest["shards"]["facets"]:
        facet_shard = json.loads((tmp_path / facets_entry["file"]).read_text())
        jsonschema.validate(instance=facet_shard, schema=schema)


def test_pins_shard_validates_against_pins_shard_schema(tmp_path):
    docs = [
        SourceDocument(
            id=1,
            url="/a",
            html='<html lang="en"><head><title>T</title>'
            '<meta name="searchable-pin" content="widgets"></head>'
            "<body><main>widgets are great</main></body></html>",
        ),
    ]
    built = build_index(docs)
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())

    schema = _load_schema("pins-shard.schema.json")
    for _language, file in manifest.get("pins", {}).items():
        pins_shard = json.loads((tmp_path / file).read_text())
        jsonschema.validate(instance=pins_shard, schema=schema)


def test_synonym_shard_validates_against_synonym_shard_schema(tmp_path):
    docs = [_doc(1, "/a", "Widgets", "widgets are great")]
    built = build_index(docs, synonyms={"en": {"equivalences": [["Couch", "Sofa"]]}})
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())

    schema = _load_schema("synonym-shard.schema.json")
    for _language, file in manifest.get("synonyms", {}).items():
        synonym_shard = json.loads((tmp_path / file).read_text())
        jsonschema.validate(instance=synonym_shard, schema=schema)


def test_vector_shard_validates_against_vector_shard_schema(tmp_path):
    def embed(texts: list[str]) -> list[list[float]]:
        return [[float(len(t)), float(i)] for i, t in enumerate(texts)]

    docs = [
        _doc(1, "/a", "Widgets", "widgets are great and useful", lang="en"),
        _doc(2, "/b", "Sofas", "Unsere Sofas sind sehr bequem.", lang="de"),
    ]
    built = build_index(docs, embed=embed, embedding_provider={"type": "custom"})
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())

    manifest_schema = _load_schema("manifest.schema.json")
    jsonschema.validate(instance=manifest, schema=manifest_schema)

    vector_schema = _load_schema("vector-shard.schema.json")
    for _language, file in manifest["vectors"]["shards"].items():
        vector_shard = json.loads((tmp_path / file).read_text())
        jsonschema.validate(instance=vector_shard, schema=vector_schema)


def test_fuzzy_shard_validates_against_fuzzy_shard_schema(tmp_path):
    docs = [_doc(1, "/a", "Widgets", "widgets are great")]
    built = build_index(docs, fuzzy=True)
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())

    schema = _load_schema("fuzzy-shard.schema.json")
    for _language, entry in manifest.get("fuzzy", {}).items():
        fuzzy_shard = json.loads((tmp_path / entry["file"]).read_text())
        jsonschema.validate(instance=fuzzy_shard, schema=schema)


def test_structured_index_manifest_and_doc_store_validate_against_schema(tmp_path):
    from searchable_indexer.build_index import build_index_documents
    from searchable_indexer.document import FieldDefinition, IndexDocument

    docs = [
        IndexDocument(
            id=1,
            external_id="docs/widgets.md#overview",
            url="/widgets",
            language="en",
            indexed_fields={"title": "Widgets", "body": "widgets are great"},
            stored_fields={"title": "Widgets", "heading": "Overview"},
            metadata={"chunkIndex": 0, "tags": ["a", "b"]},
        )
    ]
    fields = {
        "title": FieldDefinition(indexed=True, stored=True, boost=3.0),
        "body": FieldDefinition(indexed=True, stored=False),
        "heading": FieldDefinition(indexed=False, stored=True),
    }
    built = build_index_documents(docs, field_definitions=fields)
    write_index(built, str(tmp_path))

    manifest = json.loads((tmp_path / "manifest.json").read_text())
    jsonschema.validate(instance=manifest, schema=_load_schema("manifest.schema.json"))

    doc_store_schema = _load_schema("doc-store-shard.schema.json")
    for docs_entry in manifest["shards"]["docs"]:
        doc_store_shard = json.loads((tmp_path / docs_entry["file"]).read_text())
        jsonschema.validate(instance=doc_store_shard, schema=doc_store_schema)
