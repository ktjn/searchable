from searchable_indexer.byte_writer import ByteWriter

# Direct port of packages/indexer/src/binary-fuzzy-shard.ts's
# encodeFuzzyShardBinary.


def encode_fuzzy_shard_binary(shard: dict) -> bytes:
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
    for variant, blob in zip(variants, blobs):
        header.write_string(variant)
        header.write_varint(offset)
        header.write_varint(len(blob))
        offset += len(blob)

    blob_writer = ByteWriter()
    for blob in blobs:
        blob_writer.write_bytes(blob)

    return header.to_bytes() + blob_writer.to_bytes()
