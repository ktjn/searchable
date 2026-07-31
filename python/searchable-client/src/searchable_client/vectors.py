from dataclasses import dataclass
from math import sqrt

from searchable_client.types import VectorShard, vector_shard_from_dict

DEFAULT_RRF_K = 60


@dataclass(frozen=True)
class VectorHit:
    doc_id: int
    passage_id: str
    score: float


def dequantize_vector(vector: list[float], shard: VectorShard) -> list[float]:
    if shard.quantization != "int8" or shard.quant_range is None:
        return list(vector)
    minimum, maximum = shard.quant_range
    value_range = maximum - minimum
    return [minimum + (raw / 255.0) * value_range for raw in vector]


def cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(left * right for left, right in zip(a, b, strict=False))
    norm_a = sum(value * value for value in a)
    norm_b = sum(value * value for value in b)
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (sqrt(norm_a) * sqrt(norm_b))


def brute_force_vector_search(
    query_vector: list[float], shard: VectorShard, limit: int
) -> list[VectorHit]:
    best_by_doc: dict[int, VectorHit] = {}
    for entry in shard.entries:
        score = cosine_similarity(query_vector, dequantize_vector(entry.vector, shard))
        existing = best_by_doc.get(entry.doc_id)
        if existing is None or score > existing.score:
            best_by_doc[entry.doc_id] = VectorHit(entry.doc_id, entry.passage_id, score)
    return sorted(
        best_by_doc.values(), key=lambda hit: (-hit.score, hit.doc_id, hit.passage_id)
    )[:limit]


def reciprocal_rank_fusion(
    ranked_id_lists: list[list[int]], k: int = DEFAULT_RRF_K
) -> dict[int, float]:
    fused: dict[int, float] = {}
    for ids in ranked_id_lists:
        for index, doc_id in enumerate(ids):
            fused[doc_id] = fused.get(doc_id, 0.0) + 1.0 / (k + index + 1)
    return fused


__all__ = [
    "DEFAULT_RRF_K",
    "VectorHit",
    "brute_force_vector_search",
    "cosine_similarity",
    "dequantize_vector",
    "reciprocal_rank_fusion",
    "vector_shard_from_dict",
]
