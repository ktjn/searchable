from searchable_indexer.vectors import build_vector_shards, chunk_text, quantize_int8


def test_short_text_returns_a_single_chunk():
    assert chunk_text("widgets are great", window=200, overlap=20) == [
        "widgets are great"
    ]


def test_long_text_splits_into_overlapping_windows():
    words = [f"w{i}" for i in range(25)]
    text = " ".join(words)

    chunks = chunk_text(text, window=10, overlap=2)

    assert chunks == [
        " ".join(words[0:10]),
        " ".join(words[8:18]),
        " ".join(words[16:25]),
    ]


def test_empty_text_returns_no_chunks():
    assert chunk_text("   ", window=10, overlap=2) == []


def test_quantize_int8_scales_against_corpus_wide_min_max():
    quantized, quant_range = quantize_int8([[0.0, 1.0], [-1.0, 0.0]])

    assert quant_range == {"min": -1.0, "max": 1.0}
    assert quantized == [[128, 255], [0, 128]]


def test_quantize_int8_identical_values_become_zero():
    quantized, quant_range = quantize_int8([[5.0, 5.0], [5.0, 5.0]])

    assert quant_range == {"min": 5.0, "max": 5.0}
    assert quantized == [[0, 0], [0, 0]]


def _length_embed(texts: list[str]) -> list[list[float]]:
    return [[float(len(t)), 0.0] for t in texts]


def test_build_vector_shards_produces_one_passage_per_short_document():
    documents = [(1, "en", "widgets are great")]

    shards = build_vector_shards(
        documents, embed=_length_embed, quantization="float32"
    )

    assert set(shards.keys()) == {"en"}
    shard = shards["en"]
    assert shard["dims"] == 2
    assert shard["quantization"] == "float32"
    assert "quantRange" not in shard
    assert shard["entries"] == [
        {"passageId": "1-0", "docId": 1, "vector": [17.0, 0.0]}
    ]


def test_build_vector_shards_groups_entries_by_language():
    documents = [(1, "en", "widgets are great"), (2, "de", "sofas sind toll")]

    shards = build_vector_shards(
        documents, embed=_length_embed, quantization="float32"
    )

    assert set(shards.keys()) == {"en", "de"}
    assert [e["docId"] for e in shards["en"]["entries"]] == [1]
    assert [e["docId"] for e in shards["de"]["entries"]] == [2]


def test_build_vector_shards_chunks_long_documents_into_multiple_passages():
    words = [f"w{i}" for i in range(25)]
    documents = [(1, "en", " ".join(words))]

    shards = build_vector_shards(
        documents,
        embed=_length_embed,
        quantization="float32",
        window=10,
        overlap=2,
    )

    passage_ids = [e["passageId"] for e in shards["en"]["entries"]]
    assert passage_ids == ["1-0", "1-1", "1-2"]
    assert all(e["docId"] == 1 for e in shards["en"]["entries"])


def test_build_vector_shards_applies_int8_quantization_per_language():
    documents = [(1, "en", "widgets are great")]

    shards = build_vector_shards(documents, embed=_length_embed, quantization="int8")

    shard = shards["en"]
    assert shard["quantization"] == "int8"
    assert shard["quantRange"] == {"min": 0.0, "max": 17.0}
    assert shard["entries"][0]["vector"] == [255, 0]
