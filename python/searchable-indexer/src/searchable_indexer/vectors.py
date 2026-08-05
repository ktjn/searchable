import math
from collections.abc import Callable
from typing import Any


def _validate_vectors(vectors: list[list[float]], expected_count: int) -> int:
    if len(vectors) != expected_count:
        raise ValueError(
            f"build_vector_shards: embed() returned the wrong number of vectors "
            f"-- expected {expected_count} vectors, got {len(vectors)}"
        )
    dims = len(vectors[0]) if vectors else 0
    if dims == 0:
        raise ValueError(
            "build_vector_shards: embed() returned zero-dimensional vectors "
            "-- every vector must have at least one dimension"
        )
    for vector in vectors:
        if len(vector) != dims:
            raise ValueError(
                f"build_vector_shards: embed() returned vectors with inconsistent "
                f"dimensions -- expected {dims}, got {len(vector)}"
            )
        for value in vector:
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError(
                    f"build_vector_shards: embed() returned a non-numeric vector "
                    f"value {value!r} -- every vector value must be an int or float"
                )
            if not math.isfinite(value):
                raise ValueError(
                    f"build_vector_shards: embed() returned a non-finite vector "
                    f"value {value!r} -- every vector value must be finite"
                )
    return dims


def quantize_int8(
    vectors: list[list[float]],
) -> tuple[list[list[int]], dict[str, float]]:
    values = [value for vector in vectors for value in vector]
    if not values:
        return [], {"min": 0.0, "max": 0.0}
    min_value = min(values)
    max_value = max(values)
    value_range = max_value - min_value
    if value_range == 0:
        quantized = [[0 for _ in vector] for vector in vectors]
    else:
        quantized = [
            [round(((value - min_value) / value_range) * 255) for value in vector]
            for vector in vectors
        ]
    return quantized, {"min": min_value, "max": max_value}


def chunk_text(text: str, window: int = 200, overlap: int = 20) -> list[str]:
    words = text.split()
    if not words:
        return []
    step = max(window - overlap, 1)
    chunks: list[str] = []
    i = 0
    while i < len(words):
        chunks.append(" ".join(words[i : i + window]))
        if i + window >= len(words):
            break
        i += step
    return chunks


def build_vector_shards(
    documents: list[tuple[int, str, str]],
    embed: Callable[[list[str]], list[list[float]]],
    quantization: str = "int8",
    window: int = 200,
    overlap: int = 20,
    chunk: bool = True,
) -> dict[str, dict[str, Any]]:
    # passageId ("<docId>-<chunkIndex>") is stable only while docId and the
    # window/overlap params don't change -- not yet a stable public citation
    # id (docs/guides/vector-search.md#storage-format).
    if quantization not in ("int8", "float32"):
        raise ValueError(
            f"build_vector_shards: invalid quantization {quantization!r} "
            '-- must be "int8" or "float32"'
        )
    if not isinstance(window, int) or isinstance(window, bool) or window <= 0:
        raise ValueError(
            f"build_vector_shards: invalid window {window!r} -- must be a positive integer"
        )
    if (
        not isinstance(overlap, int)
        or isinstance(overlap, bool)
        or overlap < 0
        or overlap >= window
    ):
        raise ValueError(
            f"build_vector_shards: invalid overlap {overlap!r} -- must be an "
            f"integer >= 0 and < window ({window!r})"
        )

    by_language: dict[str, list[tuple[int, str]]] = {}
    for doc_id, language, text in documents:
        if chunk:
            for passage in chunk_text(text, window, overlap):
                by_language.setdefault(language, []).append((doc_id, passage))
        else:
            by_language.setdefault(language, []).append((doc_id, text))

    shards: dict[str, dict[str, Any]] = {}
    corpus_dims: int | None = None
    for language, passages in by_language.items():
        texts = [text for _, text in passages]
        vectors = embed(texts)
        dims = _validate_vectors(vectors, len(texts))
        if corpus_dims is None:
            corpus_dims = dims
        elif dims != corpus_dims:
            raise ValueError(
                f"build_vector_shards: language {language!r} produced "
                f"{dims}-dimensional vectors, but an earlier language produced "
                f"{corpus_dims}-dimensional vectors -- every language must share "
                "the same embedding dimensionality"
            )
        quant_range: dict[str, float] | None = None
        quantized_vectors: list[list[int]] | list[list[float]]
        if quantization == "int8":
            quantized_vectors, quant_range = quantize_int8(vectors)
        else:
            quantized_vectors = vectors

        chunk_index_by_doc: dict[int, int] = {}
        entries: list[dict[str, Any]] = []
        for (doc_id, _), vector in zip(passages, quantized_vectors, strict=True):
            chunk_index = chunk_index_by_doc.get(doc_id, 0)
            entries.append(
                {
                    "passageId": f"{doc_id}-{chunk_index}",
                    "docId": doc_id,
                    "vector": vector,
                }
            )
            chunk_index_by_doc[doc_id] = chunk_index + 1

        shard: dict[str, Any] = {
            "dims": dims,
            "quantization": quantization,
            "entries": entries,
        }
        if quant_range is not None:
            shard["quantRange"] = quant_range
        shards[language] = shard

    return shards
