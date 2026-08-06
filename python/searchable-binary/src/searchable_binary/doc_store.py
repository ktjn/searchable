import math
from typing import Any

from searchable_binary.bytecode import ByteReader, ByteWriter, read_directory
from searchable_binary.types import DocStoreEntry

"""Doc-store binary codec (encode + decode), shared by the Python indexer
(writer) and the Python client (reader). Supports both the legacy v1 format
and the versioned structured v2 format."""

_STRUCTURED_MAGIC = b"SDOC"
_STRUCTURED_VERSION = 2


def _write_structured_json_value(writer: ByteWriter, value: object, path: str) -> None:
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


def _read_structured_json_value(reader: ByteReader) -> Any:
    tag = reader.read_varint()
    if tag == 0:
        return None
    if tag == 1:
        return False
    if tag == 2:
        return True
    if tag == 3:
        value = reader.read_float64()
        if not math.isfinite(value):
            raise ValueError("structured binary metadata number must be finite")
        return value
    if tag == 4:
        return reader.read_string()
    if tag == 5:
        return [_read_structured_json_value(reader) for _ in range(reader.read_varint())]
    if tag == 6:
        result: dict[str, Any] = {}
        for _ in range(reader.read_varint()):
            key = reader.read_string()
            if key in result:
                raise ValueError(f"duplicate structured binary metadata key: {key}")
            result[key] = _read_structured_json_value(reader)
        return result
    raise ValueError(f"unsupported structured binary metadata tag: {tag}")


def _write_optional_string(
    writer: ByteWriter, flags: int, bit: int, entry: dict[str, Any], name: str
) -> None:
    if flags & bit:
        value = entry[name]
        if not isinstance(value, str):
            raise ValueError(f"structured binary document field {name} must be a string")
        writer.write_string(value)


def _encode_structured_doc_store_entry(entry: dict[str, Any]) -> bytes:
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
        if (
            not isinstance(boost, (int, float))
            or isinstance(boost, bool)
            or not math.isfinite(boost)
        ):
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
            raise ValueError(
                "structured binary document fields must contain string keys and values"
            )
        writer.write_string(field_name)
        writer.write_string(field_value)
    return writer.to_bytes()


def _structured_header_length(data: bytes, binary_version: int | None) -> int:
    if binary_version is None:
        if not data.startswith(_STRUCTURED_MAGIC):
            return 0
        binary_version = _STRUCTURED_VERSION
    if binary_version == 1:
        return 0
    if binary_version != _STRUCTURED_VERSION:
        raise ValueError(f"unsupported binary document-store version: {binary_version}")
    if not data.startswith(_STRUCTURED_MAGIC):
        raise ValueError("invalid structured binary document-store magic")
    reader = ByteReader(data, len(_STRUCTURED_MAGIC))
    version = reader.read_varint()
    if version != _STRUCTURED_VERSION:
        raise ValueError(f"unsupported binary document-store version: {version}")
    return reader.position


def encode_doc_store_binary(shard: dict[str, Any]) -> bytes:
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
    for doc_id, blob in zip(ids, blobs, strict=True):
        directory.write_varint(doc_id - prev_id)
        prev_id = doc_id
        directory.write_varint(offset)
        directory.write_varint(len(blob))
        offset += len(blob)

    blob_writer = ByteWriter()
    for blob in blobs:
        blob_writer.write_bytes(blob)

    return directory.to_bytes() + blob_writer.to_bytes()


def encode_structured_doc_store_binary(shard: dict[str, dict[str, Any]]) -> bytes:
    """Encode structured documents with the versioned binary v2 format."""
    ids = sorted(int(key) for key in shard)
    blobs = [_encode_structured_doc_store_entry(shard[str(doc_id)]) for doc_id in ids]

    directory = ByteWriter()
    directory.write_varint(len(ids))
    previous_id = 0
    offset = 0
    for doc_id, blob in zip(ids, blobs, strict=True):
        directory.write_varint(doc_id - previous_id)
        previous_id = doc_id
        directory.write_varint(offset)
        directory.write_varint(len(blob))
        offset += len(blob)

    blob_writer = ByteWriter()
    for blob in blobs:
        blob_writer.write_bytes(blob)

    return (
        _STRUCTURED_MAGIC
        + bytes([_STRUCTURED_VERSION])
        + directory.to_bytes()
        + blob_writer.to_bytes()
    )


def decode_binary_doc_store_directory(
    data: bytes,
    *,
    binary_version: int | None = None,
) -> tuple[list[int], dict[int, tuple[int, int]], int]:
    r = ByteReader(data, _structured_header_length(data, binary_version))
    doc_count = r.read_varint()
    prev_id = 0

    def _delta_id(reader: ByteReader) -> int:
        nonlocal prev_id
        prev_id += reader.read_varint()
        return prev_id

    sorted_ids, index = read_directory(r, doc_count, _delta_id)
    records_length = len(data) - r.position
    if any(offset + length > records_length for offset, length in index.values()):
        raise ValueError("binary document-store record exceeds shard bounds")
    return sorted_ids, index, r.position


def decode_binary_doc_store_entry(
    data: bytes,
    directory_byte_length: int,
    offset: int,
    *,
    binary_version: int = 1,
) -> DocStoreEntry:
    r = ByteReader(data, directory_byte_length + offset)
    if binary_version == 2:
        if r.read_bytes(len(_STRUCTURED_MAGIC)) != _STRUCTURED_MAGIC:
            raise ValueError("invalid structured binary document-store magic")
        version = r.read_varint()
        if version != _STRUCTURED_VERSION:
            raise ValueError(f"unsupported binary document-store version: {version}")
        url = r.read_string()
        flags = r.read_varint()
        if flags & ~0x0F:
            raise ValueError(f"unsupported structured binary document flags: {flags}")
        boost = r.read_float64() if flags & 1 else None
        external_id = r.read_string() if flags & 2 else None
        content_hash = r.read_string() if flags & 4 else None
        metadata = _read_structured_json_value(r) if flags & 8 else None
        field_count = r.read_varint()
        structured_fields: dict[str, str] = {}
        for _ in range(field_count):
            field_name = r.read_string()
            structured_fields[field_name] = r.read_string()
        return DocStoreEntry(
            url=url,
            boost=boost,
            fields=structured_fields,
            external_id=external_id,
            metadata=metadata,
            content_hash=content_hash,
        )

    if binary_version != 1:
        raise ValueError(f"unsupported binary document-store version: {binary_version}")
    url = r.read_string()
    has_boost = r.read_varint() == 1
    boost = r.read_float64() if has_boost else None
    field_count = r.read_varint()
    fields: dict[str, str] = {}
    for _ in range(field_count):
        field_name = r.read_string()
        fields[field_name] = r.read_string()
    return DocStoreEntry(url=url, boost=boost, fields=fields)
