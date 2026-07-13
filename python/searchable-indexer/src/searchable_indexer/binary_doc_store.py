from searchable_indexer.byte_writer import ByteWriter

# Direct port of packages/indexer/src/binary-doc-store.ts's
# encodeDocStoreBinary.


def encode_doc_store_binary(shard: dict) -> bytes:
    ids = sorted(int(key) for key in shard.keys())

    blobs = []
    for doc_id in ids:
        entry = shard[str(doc_id)]
        w = ByteWriter()
        w.write_string(entry["url"])
        has_boost = "boost" in entry
        w.write_varint(1 if has_boost else 0)
        if has_boost:
            w.write_float64(entry["boost"])
        field_names = sorted(entry["fields"].keys())
        w.write_varint(len(field_names))
        for field_name in field_names:
            w.write_string(field_name)
            w.write_string(entry["fields"].get(field_name) or "")
        blobs.append(w.to_bytes())

    directory = ByteWriter()
    directory.write_varint(len(ids))
    prev_id = 0
    offset = 0
    for doc_id, blob in zip(ids, blobs):
        directory.write_varint(doc_id - prev_id)
        prev_id = doc_id
        directory.write_varint(offset)
        directory.write_varint(len(blob))
        offset += len(blob)

    blob_writer = ByteWriter()
    for blob in blobs:
        blob_writer.write_bytes(blob)

    return directory.to_bytes() + blob_writer.to_bytes()
