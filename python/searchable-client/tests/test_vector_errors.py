import json
from pathlib import Path

import pytest

from searchable_client import SearchClient, SearchOptions
from searchable_client.errors import (
    VectorProviderMismatchError,
    VectorSearchNotConfiguredError,
    VectorUnavailableError,
)
from tests.fixtures.build_index import write_basic_index


def _write_provider_index(out_dir: Path) -> str:
    manifest_url = write_basic_index(out_dir)
    manifest_path = out_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["vectors"] = {
        "dims": 2,
        "quantization": "float32",
        "embeddingProvider": {"type": "local-model", "model": "known"},
        "shards": {"en": "vectors/en.json"},
    }
    manifest_path.write_text(json.dumps(manifest))
    return manifest_url


def test_vector_mode_without_embedder_raises_explicit_error(tmp_path: Path) -> None:
    client = SearchClient(write_basic_index(tmp_path / "idx"))
    with pytest.raises(VectorSearchNotConfiguredError, match="embed_query"):
        client.search("semantic query", SearchOptions(mode="vector"))


def test_vector_mode_without_index_vectors_raises_explicit_error(tmp_path: Path) -> None:
    client = SearchClient(write_basic_index(tmp_path / "idx"), embed_query=lambda _: [1.0])
    with pytest.raises(VectorUnavailableError, match="vectors"):
        client.search("query", SearchOptions(mode="vector"))


def test_provider_mismatch_fails_before_embedding(tmp_path: Path) -> None:
    called = False

    def embed(_: str) -> list[float]:
        nonlocal called
        called = True
        return [1.0, 0.0]

    client = SearchClient(
        _write_provider_index(tmp_path / "idx"),
        embed_query={"embed": embed, "provider": {"type": "local-model", "model": "other"}},
    )
    with pytest.raises(VectorProviderMismatchError):
        client.search("query", SearchOptions(mode="vector"))
    assert called is False
