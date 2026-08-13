"""Public API for :mod:`searchable.indexer`."""

from searchable.indexer.build_index import build_index, build_index_documents
from searchable.indexer.discover import discover_html_documents
from searchable.indexer.document import FieldDefinition, IndexDocument
from searchable.indexer.extract import extract_document
from searchable.indexer.types import BuiltIndex, ExtractedDocument, PinDeclaration, SourceDocument
from searchable.indexer.write_index import write_index

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
