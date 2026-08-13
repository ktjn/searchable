"""Public API for :mod:`searchable_indexer`."""

from searchable_indexer.build_index import build_index, build_index_documents
from searchable_indexer.discover import discover_html_documents
from searchable_indexer.document import FieldDefinition, IndexDocument
from searchable_indexer.extract import extract_document
from searchable_indexer.types import BuiltIndex, ExtractedDocument, PinDeclaration, SourceDocument
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
    "discover_html_documents",
    "extract_document",
    "write_index",
]
