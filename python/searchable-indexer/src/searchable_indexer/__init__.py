"""Public API for :mod:`searchable_indexer`.

Mirrors the barrel the deleted TypeScript indexer package once exported
(``build-index.ts``, ``build-vectors.ts``, ``discover.ts``, ``extract.ts``,
``write-index.ts`` + the shared manifest/shard types).
"""

from searchable_indexer.build_index import build_index, build_index_documents
from searchable_indexer.discover import discover_html_documents
from searchable_indexer.document import FieldDefinition, IndexDocument
from searchable_indexer.extract import extract_document
from searchable_indexer.types import BuiltIndex, ExtractedDocument, PinDeclaration, SourceDocument
from searchable_indexer.vectors import build_vector_shards, chunk_text
from searchable_indexer.write_index import write_index

__all__ = [
    "BuiltIndex",
    "ExtractedDocument",
    "FieldDefinition",
    "IndexDocument",
    "PinDeclaration",
    "SourceDocument",
    "build_index",
    "build_index_documents",
    "build_vector_shards",
    "chunk_text",
    "discover_html_documents",
    "extract_document",
    "write_index",
]
