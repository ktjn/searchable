from dataclasses import dataclass, field
from typing import Any


@dataclass
class SourceDocument:
    id: int
    url: str
    html: str


@dataclass
class PinDeclaration:
    phrase: str
    mode: str  # "exact" | "contains"
    priority: float
    exclusive: bool


@dataclass
class ExtractedDocument:
    title: str
    language: str
    body: str
    excerpt: str
    url: str
    noindex: bool
    boost: float
    facets: dict[str, list[str]] = field(default_factory=dict)
    range_facets: dict[str, float] = field(default_factory=dict)
    pins: list[PinDeclaration] = field(default_factory=list)


@dataclass
class BuiltIndex:
    manifest: dict[str, Any]
    term_shards: dict[str, dict[str, Any]]
    doc_store: dict[str, Any]
    id_range: tuple[int, int]
    facet_shards: dict[str, dict[str, Any]] = field(default_factory=dict)
    pins_shards: dict[str, dict[str, Any]] = field(default_factory=dict)
    synonym_shards: dict[str, dict[str, Any]] = field(default_factory=dict)
    fuzzy_shards: dict[str, dict[str, Any]] = field(default_factory=dict)
    vector_shards: dict[str, dict[str, Any]] = field(default_factory=dict)
    embedding_provider: dict[str, Any] | None = None
    structured: bool = False
