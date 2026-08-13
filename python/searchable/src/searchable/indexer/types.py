from dataclasses import dataclass, field
from typing import Any


@dataclass
class SourceDocument:
    id: int
    url: str
    html: str


@dataclass(frozen=True)
class SectionIndexingConfig:
    """Opt-in heading-level indexing for HTML pages.

    `selectors` must be HTML heading element selectors (``h1`` .. ``h6``).
    `mode` controls whether the page-level document is retained alongside the
    section documents:

    - ``"sections"`` -- index sections only, falling back to the page document
      when no eligible section exists.
    - ``"page-and-sections"`` -- index the page document and every section.
    """

    selectors: tuple[str, ...] = ("h2", "h3")
    mode: str = "sections"  # "sections" | "page-and-sections"


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
    metadata: dict[str, str] = field(default_factory=dict)


@dataclass
class ExtractedSection:
    title: str
    page_title: str
    body: str
    url: str
    anchor: str
    heading_level: int


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
    structured: bool = False
    pin_warnings: list[str] = field(default_factory=list)
