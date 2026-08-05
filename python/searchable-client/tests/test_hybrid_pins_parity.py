import json
from pathlib import Path

from searchable_client import SearchClient, SearchOptions
from searchable_client.fetch import ShardCache
from searchable_client.search import search
from searchable_client.validate_manifest import validate_manifest
from tests.fixtures.build_index import write_basic_index, write_index_with_pins


def _write_pinned_vector_index(out_dir: Path) -> str:
    """Docs 1 + 2 both contain 'widget' (doc 2 pinned on 'widget' at priority 10) --
    plus a doc 3 that only appears in the vector shard (not in the term shard) and is
    the closest cosine match to the query vector. Under hybrid fusion, doc 3 should be
    folded in as a vector-only hit WITHOUT displacing the pinned doc 2 from the front
    (the TS fuseHybridResult parity fix)."""
    manifest_url = write_index_with_pins(out_dir)

    docs_file = out_dir / "docs" / "0.json"
    doc_shard = json.loads(docs_file.read_text())
    doc_shard["3"] = {"url": "https://example.com/3", "fields": {"title": "Acme Guide"}}
    docs_file.write_text(json.dumps(doc_shard))

    (out_dir / "vectors").mkdir(exist_ok=True)
    (out_dir / "vectors" / "en.json").write_text(
        json.dumps(
            {
                "dims": 2,
                "quantization": "float32",
                "entries": [
                    {"passageId": "3-0", "docId": 3, "vector": [1.0, 0.0]},
                    {"passageId": "1-0", "docId": 1, "vector": [0.9, 0.1]},
                    {"passageId": "2-0", "docId": 2, "vector": [0.5, 0.5]},
                ],
            }
        )
    )
    manifest_path = out_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["vectors"] = {
        "dims": 2,
        "quantization": "float32",
        "embeddingProvider": {"type": "custom"},
        "shards": {"en": "vectors/en.json"},
    }
    manifest_path.write_text(json.dumps(manifest))
    return manifest_url


def test_hybrid_fusion_carries_pinned_hit_through_untouched(tmp_path: Path) -> None:
    client = SearchClient(
        _write_pinned_vector_index(tmp_path / "idx"),
        embed_query=lambda _: [1.0, 0.0],
    )
    result = client.search("widget", SearchOptions(mode="hybrid", limit=3))

    assert result.hits[0].id == 2
    assert result.hits[0].pinned is True
    # The vector-only doc 3 (closest cosine match) is folded into the fused
    # result but its rank can never displace the pinned hit.
    assert 3 in {hit.id for hit in result.hits}


def test_hybrid_total_hits_counts_pins_and_fused_candidates(tmp_path: Path) -> None:
    client = SearchClient(
        _write_pinned_vector_index(tmp_path / "idx"),
        embed_query=lambda _: [1.0, 0.0],
    )
    result = client.search("widget", SearchOptions(mode="hybrid", limit=3))
    assert result.total_hits == 3  # pinned doc 2 + fused docs 1, 3


def test_pinned_hit_not_re_scored_by_fusion(tmp_path: Path) -> None:
    client = SearchClient(
        _write_pinned_vector_index(tmp_path / "idx"),
        embed_query=lambda _: [1.0, 0.0],
    )
    pinned = client.search("widget", SearchOptions(mode="lexical", limit=3)).hits[0]
    fused = client.search("widget", SearchOptions(mode="hybrid", limit=3)).hits[0]
    assert fused.id == pinned.id == 2
    assert fused.pinned is True


def test_raw_vector_search_returns_empty_when_language_has_no_vector_shard(
    tmp_path: Path,
) -> None:
    manifest_url = write_basic_index(tmp_path / "idx")
    cache = ShardCache()
    manifest = validate_manifest(cache.fetch_json(manifest_url), manifest_url)
    result = search(
        "widget",
        manifest,
        cache,
        manifest_url,
        SearchOptions(mode="vector"),
        query_vector=[1.0, 0.0],
    )
    assert result.hits == []
    assert result.total_hits == 0
