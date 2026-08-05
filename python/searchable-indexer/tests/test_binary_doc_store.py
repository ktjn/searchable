import math

import pytest

from searchable_indexer.binary_doc_store import (
    encode_doc_store_binary,
    encode_structured_doc_store_binary,
)


def test_encodes_a_single_doc_shard():
    shard = {"0": {"url": "/a", "fields": {"t": "x"}}}
    encoded = encode_doc_store_binary(shard)
    # Directory: docCount=1, idDelta=0, offset=0, length=9
    #   -> 0x01, 0x00, 0x00, 0x09
    # Record blob: string("/a"), hasBoost=0, fieldCount=1,
    # string("t"), string("x")
    #   -> 0x02,0x2F,0x61, 0x00, 0x01, 0x01,0x74, 0x01,0x78
    expected = bytes(
        [
            0x01,
            0x00,
            0x00,
            0x09,
            0x02,
            0x2F,
            0x61,
            0x00,
            0x01,
            0x01,
            0x74,
            0x01,
            0x78,
        ]
    )
    assert encoded == expected


def test_docs_are_encoded_in_ascending_numeric_id_order():
    shard = {
        "20": {"url": "/b", "fields": {}},
        "3": {"url": "/a", "fields": {}},
    }
    encoded = encode_doc_store_binary(shard)
    # Directory: docCount=2(0x02), then first entry's idDelta must be
    # 3 (doc id 3, string sort would have put "20" first, numeric sort
    # correctly puts 3 first).
    assert encoded[0] == 0x02
    assert encoded[1] == 0x03


def test_doc_with_boost_encodes_float64_boost():
    shard = {"0": {"url": "/a", "boost": 2.0, "fields": {}}}
    encoded = encode_doc_store_binary(shard)
    boost_bytes = bytes([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40])
    assert boost_bytes in encoded


def test_second_doc_id_delta_is_relative_to_previous_id():
    shard = {
        "5": {"url": "/a", "fields": {}},
        "8": {"url": "/b", "fields": {}},
    }
    encoded = encode_doc_store_binary(shard)
    # Directory: docCount=2, first idDelta=5, ..., second idDelta=8-5=3.
    assert encoded[0] == 0x02
    assert encoded[1] == 0x05


def test_structured_doc_store_encodes_all_rag_fields_deterministically():
    shard = {
        "7": {
            "url": "/docs/rag",
            "boost": 1.5,
            "externalId": "docs/rag.md#answer",
            "contentHash": "sha256:abc",
            "metadata": {"chunkIndex": 2, "headingPath": ["RAG", "Answer"]},
            "fields": {"content": "Evidence", "title": "RAG"},
        }
    }
    reordered = {
        "7": {
            "fields": {"title": "RAG", "content": "Evidence"},
            "metadata": {"headingPath": ["RAG", "Answer"], "chunkIndex": 2},
            "contentHash": "sha256:abc",
            "externalId": "docs/rag.md#answer",
            "boost": 1.5,
            "url": "/docs/rag",
        }
    }

    encoded = encode_structured_doc_store_binary(shard)

    assert encoded == encode_structured_doc_store_binary(reordered)
    assert encoded.startswith(b"SDOC\x02")


def test_structured_doc_store_encodes_empty_optional_values():
    encoded = encode_structured_doc_store_binary(
        {"1": {"url": "/empty", "fields": {}, "metadata": {}}}
    )

    assert encoded.startswith(b"SDOC\x02")
    assert len(encoded) > 5


def test_structured_doc_store_rejects_non_finite_metadata():
    with pytest.raises(ValueError, match="finite"):
        encode_structured_doc_store_binary(
            {"1": {"url": "/bad", "fields": {}, "metadata": {"score": math.inf}}}
        )
