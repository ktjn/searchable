from searchable_client.byte_reader import ByteReader


def decode_binary_fuzzy_shard_directory(
    data: bytes,
) -> tuple[int, list[str], dict[str, tuple[int, int]], int]:
    r = ByteReader(data, 0)
    max_edits = r.read_varint()
    variant_count = r.read_varint()
    sorted_variants: list[str] = []
    index: dict[str, tuple[int, int]] = {}
    for _ in range(variant_count):
        variant = r.read_string()
        offset = r.read_varint()
        length = r.read_varint()
        sorted_variants.append(variant)
        index[variant] = (offset, length)
    return max_edits, sorted_variants, index, r.position


def decode_binary_fuzzy_entry(data: bytes, directory_byte_length: int, offset: int) -> list[str]:
    r = ByteReader(data, directory_byte_length + offset)
    term_count = r.read_varint()
    return [r.read_string() for _ in range(term_count)]
