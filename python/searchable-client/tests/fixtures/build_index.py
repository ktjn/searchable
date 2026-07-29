"""Hand-builds a minimal JSON-format index directly to disk for search.py unit tests.

No indexer invocation, since these tests exercise the *client's* matching/scoring
logic against a known-shape index, not indexer/client conformance (that's Task 19's
job).
"""
import json
from pathlib import Path


def write_basic_index(out_dir: Path) -> str:
    """Two docs, one field 'title', language 'en'. Returns the manifest file:// URL."""
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "terms").mkdir(exist_ok=True)
    (out_dir / "docs").mkdir(exist_ok=True)

    term_shard = {
        "widget": {
            "df": 2,
            "postings": [
                {"doc": 1, "fields": {"title": {"tf": 1, "pos": [0], "len": 2}}},
                {"doc": 2, "fields": {"title": {"tf": 1, "pos": [1], "len": 2}}},
            ],
        },
        "red": {
            "df": 1,
            "postings": [{"doc": 1, "fields": {"title": {"tf": 1, "pos": [1], "len": 2}}}],
        },
    }
    (out_dir / "terms" / "all.json").write_text(json.dumps(term_shard))

    doc_shard = {
        "1": {"url": "https://example.com/1", "fields": {"title": "Red Widget"}},
        "2": {"url": "https://example.com/2", "fields": {"title": "Blue Widget"}},
    }
    (out_dir / "docs" / "0.json").write_text(json.dumps(doc_shard))

    manifest = {
        "version": 1,
        "buildId": "test",
        "format": "json",
        "languages": ["en"],
        "defaultLanguage": "en",
        "fields": {"title": {"boost": 1.0, "stored": True}},
        "docCount": {"en": 2},
        "avgFieldLength": {"en": {"title": 2.0}},
        "shards": {
            "terms": [{"lang": "en", "prefix": "all", "file": "terms/all.json", "termCount": 2}],
            "docs": [{"shard": 0, "file": "docs/0.json", "idRange": [1, 2]}],
        },
    }
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest))
    return manifest_path.resolve().as_uri()
