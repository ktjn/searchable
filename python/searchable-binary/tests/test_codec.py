"""Direct codec tests for python/searchable-binary.

Before F.1 this package did not exist; the encode/decode logic was verified
only indirectly, split across searchable-indexer (writer) and
searchable-client (reader). These tests pin the shared round trips so a
format change is caught at the package's own gate.
"""

import pytest

from searchable_binary import (
    ByteReader,
    ByteWriter,
    decode_binary_doc_store_directory,
    decode_binary_doc_store_entry,
    decode_binary_fuzzy_entry,
    decode_binary_fuzzy_shard_directory,
    decode_binary_term_entry,
    decode_binary_term_shard_directory,
    encode_doc_store_binary,
    encode_fuzzy_shard_binary,
    encode_structured_doc_store_binary,
    encode_term_shard_binary,
    read_directory,
)
from searchable_binary.types import DocStoreEntry, FieldPosting, Posting

# Shared encode/decode round trips ------------------------------------------------------------


def test_varint_round_trips_through_byte_reader():
    for value in [0, 1, 127, 128, 300, 16383, 16384, 2**32, 2**60]:
        writer = ByteWriter()
        writer.write_varint(value)
        reader = ByteReader(writer.to_bytes())
        assert reader.read_varint() == value


def test_string_and_float64_round_trip():
    writer = ByteWriter()
    writer.write_string("hello wörld")
    writer.write_float64(3.5)
    writer.write_float64(-0.0)
    reader = ByteReader(writer.to_bytes())
    assert reader.read_string() == "hello wörld"
    assert reader.read_float64() == 3.5
    assert reader.read_float64() == -0.0


def test_read_directory_captures_offsets_and_lengths():
    writer = ByteWriter()
    writer.write_varint(2)
    entries = [("a", 0, 3), ("b", 3, 4)]
    for key, offset, length in entries:
        writer.write_string(key)
        writer.write_varint(offset)
        writer.write_varint(length)
    reader = ByteReader(writer.to_bytes())
    assert reader.read_varint() == 2
    keys, index = read_directory(reader, 2, lambda r: r.read_string())
    assert keys == ["a", "b"]
    assert index == {"a": (0, 3), "b": (3, 4)}


def test_truncated_shard_raises():
    with pytest.raises(ValueError):
        ByteReader(b"\x80").read_varint()
    with pytest.raises(ValueError):
        ByteReader(b"").read_varint()


def test_term_shard_round_trip():
    term_shard = {
        "alpha": {
            "df": 2,
            "postings": [
                {
                    "doc": 1,
                    "fields": {"title": {"tf": 1, "pos": [0], "len": 1}},
                },
                {
                    "doc": 3,
                    "boost": 2.5,
                    "fields": {
                        "title": {"tf": 2, "pos": [0, 4], "len": 5},
                        "body": {"tf": 1, "pos": [2], "len": 20},
                    },
                },
            ],
        },
        "beta": {
            "df": 1,
            "postings": [{"doc": 2, "fields": {"body": {"tf": 1, "pos": [0], "len": 7}}}],
        },
    }
    data = encode_term_shard_binary(term_shard)
    sorted_terms, index, dir_len = decode_binary_term_shard_directory(data)
    assert sorted_terms == ["alpha", "beta"]
    decoded = {}
    for term, (offset, _length) in index.items():
        decoded[term] = decode_binary_term_entry(data, dir_len, offset)
    expected_alpha = [
        Posting(doc=1, fields={"title": FieldPosting(tf=1, pos=[0], len=1)}),
        Posting(
            doc=3,
            boost=2.5,
            fields={
                "title": FieldPosting(tf=2, pos=[0, 4], len=5),
                "body": FieldPosting(tf=1, pos=[2], len=20),
            },
        ),
    ]
    expected_beta = [
        Posting(doc=2, fields={"body": FieldPosting(tf=1, pos=[0], len=7)}),
    ]
    assert decoded["alpha"].df == 2
    assert decoded["alpha"].postings == expected_alpha
    assert decoded["beta"].postings == expected_beta


def test_fuzzy_shard_round_trip():
    shard = {
        "maxEdits": 1,
        "deletions": {
            "appl": ["appl", "apple"],
            "ba": ["bag", "bad"],
            "cit": ["city"],
        },
    }
    data = encode_fuzzy_shard_binary(shard)
    max_edits, variants, index, dir_len = decode_binary_fuzzy_shard_directory(data)
    assert max_edits == 1
    assert variants == sorted(shard["deletions"].keys())
    for variant, (offset, _length) in index.items():
        assert decode_binary_fuzzy_entry(data, dir_len, offset) == shard["deletions"][variant]


def test_doc_store_v1_round_trip():
    shard = {
        "1": {"url": "https://example.com/1", "fields": {"title": "One"}},
        "2": {
            "url": "https://example.com/2",
            "boost": 1.5,
            "fields": {"title": "Two", "body": "Body"},  # type: ignore[dict-item]
        },
    }
    data = encode_doc_store_binary(shard)
    sorted_ids, index, dir_len = decode_binary_doc_store_directory(data)
    assert sorted_ids == [1, 2]
    decoded: dict[int, DocStoreEntry] = {}
    for doc_id, (offset, _length) in index.items():
        decoded[doc_id] = decode_binary_doc_store_entry(data, dir_len, offset)
    assert decoded[1].url == "https://example.com/1"
    assert decoded[1].fields == {"title": "One"}
    assert decoded[2].boost == 1.5
    assert decoded[2].fields == {"title": "Two", "body": "Body"}


def test_structured_doc_store_v2_round_trip():
    shard = {
        "1": {
            "url": "https://example.com/1",
            "externalId": "docs/one.md#top",
            "contentHash": "sha256:" + "ab" * 32,
            "metadata": {"path": ["a", "b"], "n": 1.5, "flag": True},
            "fields": {"title": "One"},
        },
        "2": {
            "url": "https://example.com/2",
            "boost": 0.5,
            "fields": {"title": "Two"},
        },
    }
    data = encode_structured_doc_store_binary(shard)
    sorted_ids, index, dir_len = decode_binary_doc_store_directory(data, binary_version=2)
    assert sorted_ids == [1, 2]
    decoded: dict[int, DocStoreEntry] = {}
    for doc_id, (offset, _length) in index.items():
        decoded[doc_id] = decode_binary_doc_store_entry(data, dir_len, offset, binary_version=2)
    assert decoded[1].external_id == "docs/one.md#top"
    assert decoded[1].content_hash == "sha256:" + "ab" * 32
    assert decoded[1].metadata == {"path": ["a", "b"], "n": 1.5, "flag": True}
    assert decoded[1].boost is None
    assert decoded[2].boost == 0.5


def test_doc_store_directory_rejects_oversized_records():
    writer = ByteWriter()
    writer.write_varint(1)
    writer.write_varint(0)  # delta id
    writer.write_varint(0)  # offset
    writer.write_varint(999)  # length exceeds buffer
    with pytest.raises(ValueError):
        decode_binary_doc_store_directory(writer.to_bytes())
