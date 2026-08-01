import math
from typing import Any

from searchable_client.byte_reader import ByteReader
from searchable_client.types import DocStoreEntry

_STRUCTURED_MAGIC = b"SDOC"
_STRUCTURED_VERSION = 2


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


def decode_binary_doc_store_directory(
    data: bytes,
    *,
    binary_version: int | None = None,
) -> tuple[list[int], dict[int, tuple[int, int]], int]:
    r = ByteReader(data, _structured_header_length(data, binary_version))
    doc_count = r.read_varint()
    sorted_ids: list[int] = []
    index: dict[int, tuple[int, int]] = {}
    prev_id = 0
    for _ in range(doc_count):
        prev_id += r.read_varint()
        doc_id = prev_id
        offset = r.read_varint()
        length = r.read_varint()
        sorted_ids.append(doc_id)
        index[doc_id] = (offset, length)
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
