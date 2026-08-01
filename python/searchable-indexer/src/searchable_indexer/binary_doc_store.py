import math

from searchable_indexer.byte_writer import ByteWriter

_STRUCTURED_MAGIC = b"SDOC"
_STRUCTURED_VERSION = 2


def _write_structured_json_value(writer: ByteWriter, value, path: str) -> None:
    if value is None:
        writer.write_varint(0)
    elif value is False:
        writer.write_varint(1)
    elif value is True:
        writer.write_varint(2)
    elif isinstance(value, (int, float)):
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError(f"structured binary metadata value at {path} must be finite")
        writer.write_varint(3)
        writer.write_float64(float(value))
    elif isinstance(value, str):
        writer.write_varint(4)
        writer.write_string(value)
    elif isinstance(value, list):
        writer.write_varint(5)
        writer.write_varint(len(value))
        for index, item in enumerate(value):
            _write_structured_json_value(writer, item, f"{path}[{index}]")
    elif isinstance(value, dict):
        writer.write_varint(6)
        keys = sorted(value)
        writer.write_varint(len(keys))
        for key in keys:
            if not isinstance(key, str):
                raise ValueError(f"structured binary metadata key at {path} must be a string")
            writer.write_string(key)
            _write_structured_json_value(writer, value[key], f"{path}.{key}")
    else:
        raise ValueError(f"structured binary metadata value at {path} is not JSON-compatible")


def _write_optional_string(writer: ByteWriter, flags: int, bit: int, entry: dict, name: str) -> None:
    if flags & bit:
        value = entry[name]
        if not isinstance(value, str):
            raise ValueError(f"structured binary document field {name} must be a string")
        writer.write_string(value)


def _encode_structured_doc_store_entry(entry: dict) -> bytes:
    writer = ByteWriter()
    writer.write_bytes(_STRUCTURED_MAGIC)
    writer.write_varint(_STRUCTURED_VERSION)
    writer.write_string(entry["url"])

    flags = 0
    if "boost" in entry:
        flags |= 1
    if "externalId" in entry:
        flags |= 2
    if "contentHash" in entry:
        flags |= 4
    if "metadata" in entry:
        flags |= 8
    writer.write_varint(flags)
    if flags & 1:
        boost = entry["boost"]
        if not isinstance(boost, (int, float)) or isinstance(boost, bool) or not math.isfinite(boost):
            raise ValueError("structured binary document boost must be finite")
        writer.write_float64(float(boost))
    _write_optional_string(writer, flags, 2, entry, "externalId")
    _write_optional_string(writer, flags, 4, entry, "contentHash")
    if flags & 8:
        _write_structured_json_value(writer, entry["metadata"], "metadata")

    fields = entry["fields"]
    if not isinstance(fields, dict):
        raise ValueError("structured binary document fields must be a mapping")
    field_names = sorted(fields)
    writer.write_varint(len(field_names))
    for field_name in field_names:
        field_value = fields[field_name]
        if not isinstance(field_name, str) or not isinstance(field_value, str):
            raise ValueError("structured binary document fields must contain string keys and values")
        writer.write_string(field_name)
        writer.write_string(field_value)
    return writer.to_bytes()

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


def encode_structured_doc_store_binary(shard: dict[str, dict]) -> bytes:
    """Encode structured documents with the versioned binary v2 format."""
    ids = sorted(int(key) for key in shard)
    blobs = [_encode_structured_doc_store_entry(shard[str(doc_id)]) for doc_id in ids]

    directory = ByteWriter()
    directory.write_varint(len(ids))
    previous_id = 0
    offset = 0
    for doc_id, blob in zip(ids, blobs):
        directory.write_varint(doc_id - previous_id)
        previous_id = doc_id
        directory.write_varint(offset)
        directory.write_varint(len(blob))
        offset += len(blob)

    blob_writer = ByteWriter()
    for blob in blobs:
        blob_writer.write_bytes(blob)

    return _STRUCTURED_MAGIC + bytes([_STRUCTURED_VERSION]) + directory.to_bytes() + blob_writer.to_bytes()
