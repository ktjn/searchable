import json
from pathlib import Path

import jsonschema

from csf_indexer.build_index import build_index
from csf_indexer.types import SourceDocument
from csf_indexer.write_index import write_index

_REPO_ROOT = Path(__file__).resolve().parents[3]
_SCHEMA_DIR = _REPO_ROOT / "spec" / "schema"


def _load_schema(name: str) -> dict:
    return json.loads((_SCHEMA_DIR / name).read_text())


def _doc(doc_id: int, url: str, title: str, body: str, lang: str = "en") -> SourceDocument:
    html = f'<html lang="{lang}"><head><title>{title}</title></head><body><main>{body}</main></body></html>'
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
