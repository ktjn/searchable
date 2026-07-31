from dataclasses import dataclass, field


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
    manifest: dict
    term_shards: dict[str, dict]
    doc_store: dict
    id_range: tuple[int, int]
    facet_shards: dict[str, dict] = field(default_factory=dict)
    pins_shards: dict[str, dict] = field(default_factory=dict)
    synonym_shards: dict[str, dict] = field(default_factory=dict)
    fuzzy_shards: dict[str, dict] = field(default_factory=dict)
    vector_shards: dict[str, dict] = field(default_factory=dict)
    embedding_provider: dict | None = None
    structured: bool = False
