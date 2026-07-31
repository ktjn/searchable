import pytest

from searchable_client.types import VectorEntry, VectorShard
from searchable_client.vectors import (
    brute_force_vector_search,
    cosine_similarity,
    dequantize_vector,
    reciprocal_rank_fusion,
)


def test_dequantize_int8_uses_shared_shard_range() -> None:
    shard = VectorShard(
        dims=2,
        quantization="int8",
        quant_range=(10.0, 20.0),
        entries=[],
    )
    assert dequantize_vector([0, 128, 255], shard) == pytest.approx([10.0, 15.0196078, 20.0])


def test_cosine_similarity_returns_zero_for_zero_vector() -> None:
    assert cosine_similarity([0.0, 0.0], [1.0, 2.0]) == 0.0


def test_vector_search_keeps_best_passage_per_document() -> None:
    shard = VectorShard(
        dims=2,
        quantization="float32",
        quant_range=None,
        entries=[
            VectorEntry("1-0", 1, [0.5, 0.5]),
            VectorEntry("1-1", 1, [1.0, 0.0]),
            VectorEntry("2-0", 2, [0.0, 1.0]),
        ],
    )
    hits = brute_force_vector_search([1.0, 0.0], shard, limit=10)
    assert [(hit.doc_id, hit.passage_id) for hit in hits] == [(1, "1-1"), (2, "2-0")]


def test_rrf_sums_one_based_reciprocal_ranks() -> None:
    fused = reciprocal_rank_fusion([[1, 2], [2, 3]], k=60)
    assert fused[2] == pytest.approx(1 / 61 + 1 / 62)
