"""Shared binary shard codec (encode + decode) for Searchable.

Single home for the binary-format byte layout in Python: the indexer
(writer) and the client (reader) both depend on this package, so a format
change is one edit per shard type instead of a 3-way hand edit across
`searchable-indexer`, `searchable-client`, and the client's test fixtures.
"""

from searchable_binary.bytecode import ByteReader, ByteWriter, read_directory
from searchable_binary.doc_store import (
    decode_binary_doc_store_directory,
    decode_binary_doc_store_entry,
    encode_doc_store_binary,
    encode_structured_doc_store_binary,
)
from searchable_binary.fuzzy_shard import (
    decode_binary_fuzzy_entry,
    decode_binary_fuzzy_shard_directory,
    encode_fuzzy_shard_binary,
)
from searchable_binary.term_shard import (
    decode_binary_term_entry,
    decode_binary_term_shard_directory,
    encode_postings,
    encode_term_shard_binary,
)

__all__ = [
    "ByteReader",
    "ByteWriter",
    "decode_binary_doc_store_directory",
    "decode_binary_doc_store_entry",
    "decode_binary_fuzzy_entry",
    "decode_binary_fuzzy_shard_directory",
    "decode_binary_term_entry",
    "decode_binary_term_shard_directory",
    "encode_doc_store_binary",
    "encode_fuzzy_shard_binary",
    "encode_postings",
    "encode_structured_doc_store_binary",
    "encode_term_shard_binary",
    "read_directory",
]
