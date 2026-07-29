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


def write_index_with_category_facet(out_dir: Path) -> str:
    """Same two docs as write_basic_index, plus a 'category' terms facet: doc 1=red, doc 2=blue."""
    manifest_url = write_basic_index(out_dir)
    (out_dir / "facets").mkdir(exist_ok=True)
    facet_shard = {
        "type": "terms",
        "values": {
            "red": {"count": 1, "docs": [1]},
            "blue": {"count": 1, "docs": [2]},
        },
    }
    (out_dir / "facets" / "category.json").write_text(json.dumps(facet_shard))

    manifest_path = out_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["shards"]["facets"] = [{"field": "category", "file": "facets/category.json"}]
    manifest_path.write_text(json.dumps(manifest))
    return manifest_url


def write_index_with_two_facets(out_dir: Path) -> str:
    """Same two docs as write_basic_index, plus TWO terms facets:
    'category' (doc1=red, doc2=blue) and 'stock' (doc1=in-stock, doc2=out-of-stock).
    """
    manifest_url = write_basic_index(out_dir)
    (out_dir / "facets").mkdir(exist_ok=True)

    category_shard = {
        "type": "terms",
        "values": {
            "red": {"count": 1, "docs": [1]},
            "blue": {"count": 1, "docs": [2]},
        },
    }
    (out_dir / "facets" / "category.json").write_text(json.dumps(category_shard))

    stock_shard = {
        "type": "terms",
        "values": {
            "in-stock": {"count": 1, "docs": [1]},
            "out-of-stock": {"count": 1, "docs": [2]},
        },
    }
    (out_dir / "facets" / "stock.json").write_text(json.dumps(stock_shard))

    manifest_path = out_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["shards"]["facets"] = [
        {"field": "category", "file": "facets/category.json"},
        {"field": "stock", "file": "facets/stock.json"},
    ]
    manifest_path.write_text(json.dumps(manifest))
    return manifest_url


def write_index_with_range_facet(out_dir: Path) -> str:
    """Same two docs as write_basic_index, plus a 'price' range facet: doc1=10.0, doc2=50.0."""
    manifest_url = write_basic_index(out_dir)
    (out_dir / "facets").mkdir(exist_ok=True)

    price_shard = {
        "type": "range",
        "values": {
            "0-25": {"count": 1, "docs": [1]},
            "25-75": {"count": 1, "docs": [2]},
        },
        "sorted": [
            {"value": 10.0, "doc": 1},
            {"value": 50.0, "doc": 2},
        ],
    }
    (out_dir / "facets" / "price.json").write_text(json.dumps(price_shard))

    manifest_path = out_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["shards"]["facets"] = [{"field": "price", "file": "facets/price.json"}]
    manifest_path.write_text(json.dumps(manifest))
    return manifest_url


def write_index_with_hierarchy_facet(out_dir: Path) -> str:
    """Same two docs as write_basic_index, plus a 'category' hierarchy facet with
    separator '>': doc1='electronics>audio', doc2='electronics>video'.
    """
    manifest_url = write_basic_index(out_dir)
    (out_dir / "facets").mkdir(exist_ok=True)

    category_shard = {
        "type": "hierarchy",
        "separator": ">",
        "values": {
            "electronics>audio": {"count": 1, "docs": [1]},
            "electronics>video": {"count": 1, "docs": [2]},
        },
    }
    (out_dir / "facets" / "category.json").write_text(json.dumps(category_shard))

    manifest_path = out_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["shards"]["facets"] = [{"field": "category", "file": "facets/category.json"}]
    manifest_path.write_text(json.dumps(manifest))
    return manifest_url
