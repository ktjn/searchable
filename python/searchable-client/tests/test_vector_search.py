import json
from pathlib import Path

import pytest

from searchable_client import SearchClient, SearchOptions
from searchable_client.errors import InvalidVectorShardError
from tests.fixtures.build_index import write_basic_index


def _write_vector_index(out_dir: Path, *, bad_entry: bool = False) -> str:
    manifest_url = write_basic_index(out_dir)
    (out_dir / "vectors").mkdir()
    (out_dir / "vectors" / "en.json").write_text(
        json.dumps(
            {
                "dims": 2,
                "quantization": "float32",
                "entries": [
                    {"passageId": "1-0", "docId": 1, "vector": [0.5, 0.5]},
                    {"passageId": "1-1", "docId": 1, "vector": [0.9, 0.1]},
                    {
                        "passageId": "2-0",
                        "docId": 2,
                        "vector": [1.0, 0.0] if not bad_entry else [1.0],
                    },
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


def test_vector_mode_finds_best_semantic_document(tmp_path: Path) -> None:
    client = SearchClient(
        _write_vector_index(tmp_path / "idx"),
        embed_query=lambda _: [1.0, 0.0],
    )
    result = client.search("unrelated lexical words", SearchOptions(mode="vector", limit=2))
    assert [hit.id for hit in result.hits] == [2, 1]
    assert len({hit.id for hit in result.hits}) == len(result.hits)
    assert result.hits[0].score == pytest.approx(1.0)


def test_hybrid_uses_rrf_to_combine_lexical_and_vector_rankings(tmp_path: Path) -> None:
    client = SearchClient(
        _write_vector_index(tmp_path / "idx"),
        embed_query=lambda _: [1.0, 0.0],
    )
    result = client.search("red", SearchOptions(mode="hybrid", limit=2))
    assert [hit.id for hit in result.hits] == [1, 2]
    assert result.hits[0].score > 0


def test_malformed_vector_entry_dimensions_raise(tmp_path: Path) -> None:
    client = SearchClient(
        _write_vector_index(tmp_path / "idx", bad_entry=True),
        embed_query=lambda _: [1.0, 0.0],
    )
    with pytest.raises(InvalidVectorShardError, match="dims"):
        client.search("query", SearchOptions(mode="vector"))


def test_vector_search_stream_yields_configured_vector_result(tmp_path: Path) -> None:
    client = SearchClient(
        _write_vector_index(tmp_path / "idx"),
        embed_query=lambda _: [1.0, 0.0],
    )
    results = list(client.search_stream("query", SearchOptions(mode="vector", limit=1)))
    assert [hit.id for hit in results[0].hits] == [2]
