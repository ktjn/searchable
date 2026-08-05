from typing import Any

from searchable_indexer.byte_writer import ByteWriter

# Direct port of packages/indexer/src/binary-term-shard.ts's
# encodeTermShardBinary/encodePostings.


def _encode_postings(entry: dict[str, Any]) -> bytes:
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
    postings_blobs = [_encode_postings(term_shard[term]) for term in terms]

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
