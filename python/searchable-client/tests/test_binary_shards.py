import struct

import pytest

from searchable_client.binary_doc_store import (
    decode_binary_doc_store_directory,
    decode_binary_doc_store_entry,
)
from searchable_client.binary_fuzzy_shard import (
    decode_binary_fuzzy_entry,
    decode_binary_fuzzy_shard_directory,
)
from searchable_client.binary_term_shard import (
    decode_binary_term_entry,
    decode_binary_term_shard_directory,
    terms_with_binary_prefix,
)
from searchable_client.byte_reader import ByteReader


def _varint(n: int) -> bytes:
    out = bytearray()
    while True:
        byte = n & 0x7F
        n >>= 7
        if n:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def _string(s: str) -> bytes:
    encoded = s.encode("utf-8")
    return _varint(len(encoded)) + encoded


def test_byte_reader_reads_varint_string_float64():
    payload = _varint(300) + _string("hello") + struct.pack("<d", 3.5)
    r = ByteReader(payload)
    assert r.read_varint() == 300
    assert r.read_string() == "hello"
    assert r.read_float64() == 3.5


def test_term_shard_directory_and_entry_roundtrip():
    # One term "cat": df=1, one posting doc=5, no boost, one field "title" tf=1 len=3 pos=[0]
    postings_blob = (
        _varint(1)  # df
        + _varint(1)  # postingCount
        + _varint(5)  # doc delta (prevDoc starts at 0)
        + _varint(0)  # hasBoost = false
        + _varint(1)  # fieldCount
        + _string("title")
        + _varint(1)  # tf
        + _varint(3)  # len
        + _varint(1)  # posCount
        + _varint(0)  # pos delta
    )
    directory = _varint(1) + _string("cat") + _varint(0) + _varint(len(postings_blob))
    data = directory + postings_blob

    sorted_terms, index, dir_len = decode_binary_term_shard_directory(data)
    assert sorted_terms == ["cat"]
    entry = decode_binary_term_entry(data, dir_len, index["cat"][0])
    assert entry.df == 1
    assert entry.postings[0].doc == 5
    assert entry.postings[0].fields["title"].tf == 1
    assert terms_with_binary_prefix(sorted_terms, "ca") == ["cat"]
    assert terms_with_binary_prefix(sorted_terms, "zz") == []


def test_doc_store_directory_and_entry_roundtrip():
    record = (
        _string("https://example.com/p")
        + _varint(0)
        + _varint(1)
        + _string("title")
        + _string("Widget")
    )
    directory = _varint(1) + _varint(5) + _varint(0) + _varint(len(record))
    data = directory + record
    sorted_ids, index, dir_len = decode_binary_doc_store_directory(data)
    assert sorted_ids == [5]
    entry = decode_binary_doc_store_entry(data, dir_len, index[5][0])
    assert entry.url == "https://example.com/p"
    assert entry.fields["title"] == "Widget"


def _tagged_string(value: str) -> bytes:
    return _varint(4) + _string(value)


def _tagged_metadata() -> bytes:
    # object {"chunkIndex": 2, "headingPath": ["RAG", "Answer"]}
    return (
        _varint(6)
        + _varint(2)
        + _string("chunkIndex")
        + _varint(3)
        + struct.pack("<d", 2.0)
        + _string("headingPath")
        + _varint(5)
        + _varint(2)
        + _tagged_string("RAG")
        + _tagged_string("Answer")
    )


def test_structured_doc_store_v2_directory_and_entry_roundtrip():
    record = (
        b"SDOC"
        + _varint(2)
        + _string("https://example.com/rag")
        + _varint(15)
        + struct.pack("<d", 1.5)
        + _string("docs/rag.md#answer")
        + _string("sha256:abc")
        + _tagged_metadata()
        + _varint(1)
        + _string("content")
        + _string("Evidence")
    )
    directory = _varint(1) + _varint(7) + _varint(0) + _varint(len(record))
    data = b"SDOC" + _varint(2) + directory + record

    sorted_ids, index, dir_len = decode_binary_doc_store_directory(data)
    entry = decode_binary_doc_store_entry(data, dir_len, index[7][0], binary_version=2)

    assert sorted_ids == [7]
    assert entry.url == "https://example.com/rag"
    assert entry.external_id == "docs/rag.md#answer"
    assert entry.content_hash == "sha256:abc"
    assert entry.metadata == {"chunkIndex": 2.0, "headingPath": ["RAG", "Answer"]}
    assert entry.fields == {"content": "Evidence"}


def test_structured_doc_store_v2_rejects_bad_magic():
    with pytest.raises(ValueError, match="magic"):
        decode_binary_doc_store_directory(b"NOPE\x02", binary_version=2)


def test_structured_doc_store_v2_rejects_truncated_record():
    data = b"SDOC" + _varint(2) + _varint(1) + _varint(1) + _varint(0) + _varint(10) + b"x"
    with pytest.raises(ValueError, match="end|truncated|bounds"):
        decode_binary_doc_store_directory(data)


def test_fuzzy_directory_and_entry_roundtrip():
    entry_bytes = _varint(1) + _string("cat")
    directory = _varint(1) + _varint(1) + _string("ct") + _varint(0) + _varint(len(entry_bytes))
    data = directory + entry_bytes
    max_edits, sorted_variants, index, dir_len = decode_binary_fuzzy_shard_directory(data)
    assert max_edits == 1
    assert sorted_variants == ["ct"]
    terms = decode_binary_fuzzy_entry(data, dir_len, index["ct"][0])
    assert terms == ["cat"]
