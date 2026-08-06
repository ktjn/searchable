from typing import Any

from searchable_binary.bytecode import ByteReader, ByteWriter, read_directory
from searchable_binary.types import FieldPosting, Posting, TermEntry

"""Term-shard binary codec (encode + decode), shared by the Python indexer
(writer) and the Python client (reader). Directory decodes parse only the
sorted term -> (byte offset, byte length) table; term entries are decoded by
seeking directly to their byte range."""


def encode_postings(entry: dict[str, Any]) -> bytes:
    w = ByteWriter()
    w.write_varint(entry["df"])
    w.write_varint(len(entry["postings"]))
    prev_doc = 0
    for posting in entry["postings"]:
        w.write_varint(posting["doc"] - prev_doc)
        prev_doc = posting["doc"]
        has_boost = "boost" in posting
        w.write_varint(1 if has_boost else 0)
        if has_boost:
            w.write_float64(posting["boost"])
        field_names = sorted(posting["fields"].keys())
        w.write_varint(len(field_names))
        for field_name in field_names:
            field = posting["fields"][field_name]
            w.write_string(field_name)
            w.write_varint(field["tf"])
            w.write_varint(field["len"])
            w.write_varint(len(field["pos"]))
            prev_pos = 0
            for pos in field["pos"]:
                w.write_varint(pos - prev_pos)
                prev_pos = pos
    return w.to_bytes()


def encode_term_shard_binary(term_shard: dict[str, Any]) -> bytes:
    terms = sorted(term_shard.keys())
    postings_blobs = [encode_postings(term_shard[term]) for term in terms]

    directory = ByteWriter()
    directory.write_varint(len(terms))
    offset = 0
    for term, blob in zip(terms, postings_blobs, strict=True):
        directory.write_string(term)
        directory.write_varint(offset)
        directory.write_varint(len(blob))
        offset += len(blob)

    postings_blob = ByteWriter()
    for blob in postings_blobs:
        postings_blob.write_bytes(blob)

    return directory.to_bytes() + postings_blob.to_bytes()


def decode_binary_term_shard_directory(
    data: bytes,
) -> tuple[list[str], dict[str, tuple[int, int]], int]:
    r = ByteReader(data, 0)
    term_count = r.read_varint()
    sorted_terms, index = read_directory(r, term_count, lambda reader: reader.read_string())
    return sorted_terms, index, r.position


def decode_binary_term_entry(data: bytes, directory_byte_length: int, offset: int) -> TermEntry:
    r = ByteReader(data, directory_byte_length + offset)
    df = r.read_varint()
    posting_count = r.read_varint()
    postings: list[Posting] = []
    prev_doc = 0
    for _ in range(posting_count):
        prev_doc += r.read_varint()
        doc = prev_doc
        has_boost = r.read_varint() == 1
        boost = r.read_float64() if has_boost else None
        field_count = r.read_varint()
        fields: dict[str, FieldPosting] = {}
        for _ in range(field_count):
            field_name = r.read_string()
            tf = r.read_varint()
            length = r.read_varint()
            pos_count = r.read_varint()
            pos: list[int] = []
            prev_pos = 0
            for _ in range(pos_count):
                prev_pos += r.read_varint()
                pos.append(prev_pos)
            fields[field_name] = FieldPosting(tf=tf, pos=pos, len=length)
        postings.append(Posting(doc=doc, boost=boost, fields=fields))
    return TermEntry(df=df, postings=postings)
