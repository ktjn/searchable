from searchable_client.byte_reader import ByteReader
from searchable_client.types import DocStoreEntry


def decode_binary_doc_store_directory(
    data: bytes,
) -> tuple[list[int], dict[int, tuple[int, int]], int]:
    r = ByteReader(data, 0)
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
    return sorted_ids, index, r.position


def decode_binary_doc_store_entry(
    data: bytes, directory_byte_length: int, offset: int
) -> DocStoreEntry:
    r = ByteReader(data, directory_byte_length + offset)
    url = r.read_string()
    has_boost = r.read_varint() == 1
    boost = r.read_float64() if has_boost else None
    field_count = r.read_varint()
    fields: dict[str, str] = {}
    for _ in range(field_count):
        field_name = r.read_string()
        fields[field_name] = r.read_string()
    return DocStoreEntry(url=url, boost=boost, fields=fields)
