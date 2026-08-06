from typing import Any

from searchable_binary.bytecode import ByteReader, ByteWriter, read_directory

"""Fuzzy-shard binary codec (encode + decode), shared by the Python indexer
(writer) and the Python client (reader)."""


def encode_fuzzy_shard_binary(shard: dict[str, Any]) -> bytes:
    variants = sorted(shard["deletions"].keys())
    blobs = []
    for variant in variants:
        terms = shard["deletions"].get(variant, [])
        w = ByteWriter()
        w.write_varint(len(terms))
        for term in terms:
            w.write_string(term)
        blobs.append(w.to_bytes())

    header = ByteWriter()
    header.write_varint(shard["maxEdits"])
    header.write_varint(len(variants))
    offset = 0
    for variant, blob in zip(variants, blobs, strict=True):
        header.write_string(variant)
        header.write_varint(offset)
        header.write_varint(len(blob))
        offset += len(blob)

    blob_writer = ByteWriter()
    for blob in blobs:
        blob_writer.write_bytes(blob)

    return header.to_bytes() + blob_writer.to_bytes()


def decode_binary_fuzzy_shard_directory(
    data: bytes,
) -> tuple[int, list[str], dict[str, tuple[int, int]], int]:
    r = ByteReader(data, 0)
    max_edits = r.read_varint()
    variant_count = r.read_varint()
    sorted_variants, index = read_directory(r, variant_count, lambda reader: reader.read_string())
    return max_edits, sorted_variants, index, r.position


def decode_binary_fuzzy_entry(data: bytes, directory_byte_length: int, offset: int) -> list[str]:
    r = ByteReader(data, directory_byte_length + offset)
    term_count = r.read_varint()
    return [r.read_string() for _ in range(term_count)]
