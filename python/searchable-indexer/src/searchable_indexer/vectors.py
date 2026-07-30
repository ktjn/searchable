from typing import Callable


def quantize_int8(
    vectors: list[list[float]],
) -> tuple[list[list[int]], dict[str, float]]:
    values = [value for vector in vectors for value in vector]
    if not values:
        return vectors, {"min": 0.0, "max": 0.0}
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
) -> dict[str, dict]:
    by_language: dict[str, list[tuple[int, str]]] = {}
    for doc_id, language, text in documents:
        for chunk in chunk_text(text, window, overlap):
            by_language.setdefault(language, []).append((doc_id, chunk))

    shards: dict[str, dict] = {}
    for language, passages in by_language.items():
        texts = [text for _, text in passages]
        vectors = embed(texts)
        dims = len(vectors[0]) if vectors else 0
        quant_range: dict[str, float] | None = None
        if quantization == "int8":
            vectors, quant_range = quantize_int8(vectors)

        chunk_index_by_doc: dict[int, int] = {}
        entries = []
        for (doc_id, _), vector in zip(passages, vectors):
            chunk_index = chunk_index_by_doc.get(doc_id, 0)
            entries.append(
                {
                    "passageId": f"{doc_id}-{chunk_index}",
                    "docId": doc_id,
                    "vector": vector,
                }
            )
            chunk_index_by_doc[doc_id] = chunk_index + 1

        shard: dict = {"dims": dims, "quantization": quantization, "entries": entries}
        if quant_range is not None:
            shard["quantRange"] = quant_range
        shards[language] = shard

    return shards
