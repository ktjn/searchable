from searchable_client.byte_reader import ByteReader, read_directory
from searchable_client.types import FieldPosting, Posting, TermEntry


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


def terms_with_binary_prefix(sorted_terms: list[str], prefix: str) -> list[str]:
    lo, hi = 0, len(sorted_terms)
    while lo < hi:
        mid = (lo + hi) // 2
        if sorted_terms[mid] < prefix:
            lo = mid + 1
        else:
            hi = mid
    result: list[str] = []
    for i in range(lo, len(sorted_terms)):
        if not sorted_terms[i].startswith(prefix):
            break
        result.append(sorted_terms[i])
    return result
