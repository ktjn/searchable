from dataclasses import dataclass, field
from typing import Any

from searchable_client.highlight import HighlightSpan


@dataclass(frozen=True)
class FieldPosting:
    tf: int
    pos: list[int]
    len: int


@dataclass(frozen=True)
class Posting:
    doc: int
    fields: dict[str, FieldPosting]
    boost: float | None = None


@dataclass(frozen=True)
class TermEntry:
    df: int
    postings: list[Posting]


@dataclass(frozen=True)
class DocStoreEntry:
    url: str
    fields: dict[str, str]
    boost: float | None = None
    external_id: str | None = None
    metadata: dict[str, Any] | None = None
    content_hash: str | None = None

DEFAULT_SYNONYM_WEIGHT = 0.5
DEFAULT_FUZZY_WEIGHT = 0.5


@dataclass(frozen=True)
class FieldConfig:
    boost: float = 1.0
    stored: bool = False
    indexed: bool = True


@dataclass(frozen=True)
class TermShardEntry:
    lang: str
    prefix: str
    file: str
    term_count: int


@dataclass(frozen=True)
class DocsShardEntry:
    shard: int
    file: str
    id_range: tuple[int, int]


@dataclass(frozen=True)
class FacetShardEntry:
    field: str
    file: str


@dataclass(frozen=True)
class FuzzyManifestEntry:
    file: str


@dataclass(frozen=True)
class Manifest:
    version: int
    build_id: str
    languages: list[str]
    default_language: str
    fields: dict[str, FieldConfig]
    doc_count: dict[str, int]
    avg_field_length: dict[str, dict[str, float]]
    shards_terms: list[TermShardEntry]
    shards_docs: list[DocsShardEntry]
    shards_facets: list[FacetShardEntry] = field(default_factory=list)
    pins: dict[str, str] | None = None
    synonyms: dict[str, str] | None = None
    fuzzy: dict[str, FuzzyManifestEntry] | None = None
def manifest_from_dict(data: dict[str, Any]) -> Manifest:
    shards = data["shards"]
    return Manifest(
        version=data["version"],
        build_id=data["buildId"],
        languages=list(data["languages"]),
        default_language=data["defaultLanguage"],
        fields={
            name: FieldConfig(
                boost=cfg.get("boost", 1.0),
                stored=cfg.get("stored", False),
                indexed=cfg.get("indexed", True),
            )
            for name, cfg in data["fields"].items()
        },
        doc_count=dict(data["docCount"]),
        avg_field_length={lang: dict(lens) for lang, lens in data["avgFieldLength"].items()},
        shards_terms=[
            TermShardEntry(
                lang=t["lang"],
                prefix=t["prefix"],
                file=t["file"],
                term_count=t.get("termCount", 0),
            )
            for t in shards.get("terms", [])
        ],
        shards_docs=[
            DocsShardEntry(
                shard=d["shard"],
                file=d["file"],
                id_range=(d["idRange"][0], d["idRange"][1]),
            )
            for d in shards.get("docs", [])
        ],
        shards_facets=[
            FacetShardEntry(field=f["field"], file=f["file"]) for f in shards.get("facets", [])
        ],
        pins=dict(data["pins"]) if data.get("pins") is not None else None,
        synonyms=dict(data["synonyms"]) if data.get("synonyms") is not None else None,
        fuzzy=(
            {
                lang: FuzzyManifestEntry(file=v["file"])
                for lang, v in data["fuzzy"].items()
            }
            if data.get("fuzzy") is not None
            else None
        ),
    )


@dataclass(frozen=True)
class FacetValueEntry:
    count: int
    docs: list[int]


@dataclass(frozen=True)
class RangeFacetValue:
    value: float
    doc: int


@dataclass(frozen=True)
class FacetShard:
    type: str  # "terms" | "range" | "hierarchy"
    values: dict[str, FacetValueEntry]
    separator: str | None = None
    sorted: list[RangeFacetValue] | None = None


@dataclass(frozen=True)
class PinDoc:
    id: int
    priority: float
    exclusive: bool


@dataclass(frozen=True)
class PinEntry:
    mode: str  # "exact" | "contains"
    docs: list[PinDoc]


PinsShard = dict[str, PinEntry]


@dataclass(frozen=True)
class SynonymShard:
    equivalences: list[list[str]] = field(default_factory=list)
    directional: dict[str, list[str]] = field(default_factory=dict)
    multi_word: list[list[str]] = field(default_factory=list)


@dataclass(frozen=True)
class FuzzyShard:
    max_edits: int
    deletions: dict[str, list[str]]


def term_entry_from_dict(data: dict[str, Any]) -> TermEntry:
    return TermEntry(
        df=data["df"],
        postings=[
            Posting(
                doc=p["doc"],
                boost=p.get("boost"),
                fields={
                    name: FieldPosting(tf=fp["tf"], pos=list(fp["pos"]), len=fp["len"])
                    for name, fp in p["fields"].items()
                },
            )
            for p in data["postings"]
        ],
    )


def term_shard_from_dict(data: dict[str, Any]) -> dict[str, TermEntry]:
    return {term: term_entry_from_dict(entry) for term, entry in data.items()}


def doc_store_entry_from_dict(data: dict[str, Any]) -> DocStoreEntry:
    return DocStoreEntry(
        url=data["url"],
        boost=data.get("boost"),
        fields=dict(data["fields"]),
        external_id=data.get("externalId"),
        metadata=dict(data["metadata"]) if data.get("metadata") is not None else None,
        content_hash=data.get("contentHash"),
    )


def doc_store_shard_from_dict(data: dict[str, Any]) -> dict[int, DocStoreEntry]:
    return {int(doc_id): doc_store_entry_from_dict(entry) for doc_id, entry in data.items()}


def facet_shard_from_dict(data: dict[str, Any]) -> FacetShard:
    return FacetShard(
        type=data["type"],
        separator=data.get("separator"),
        values={
            value: FacetValueEntry(count=e["count"], docs=list(e["docs"]))
            for value, e in data.get("values", {}).items()
        },
        sorted=(
            [RangeFacetValue(value=r["value"], doc=r["doc"]) for r in data["sorted"]]
            if data.get("sorted") is not None
            else None
        ),
    )


def pins_shard_from_dict(data: dict[str, Any]) -> PinsShard:
    return {
        phrase: PinEntry(
            mode=entry["mode"],
            docs=[
                PinDoc(id=d["id"], priority=d["priority"], exclusive=d["exclusive"])
                for d in entry["docs"]
            ],
        )
        for phrase, entry in data.items()
    }


def synonym_shard_from_dict(data: dict[str, Any]) -> SynonymShard:
    return SynonymShard(
        equivalences=[list(g) for g in data.get("equivalences", [])],
        directional={k: list(v) for k, v in data.get("directional", {}).items()},
        multi_word=[list(g) for g in data.get("multiWord", [])],
    )


def fuzzy_shard_from_dict(data: dict[str, Any]) -> FuzzyShard:
    return FuzzyShard(
        max_edits=data["maxEdits"],
        deletions={k: list(v) for k, v in data["deletions"].items()},
    )


@dataclass
class Hit:
    id: int
    score: float
    url: str
    fields: dict[str, str]
    pinned: bool = False
    highlights: dict[str, list[HighlightSpan]] | None = None
    external_id: str | None = None
    metadata: dict[str, Any] | None = None
    content_hash: str | None = None


@dataclass
class SearchResult:
    hits: list[Hit]
    total_hits: int
    language: str
    facets: "dict[str, FacetResult] | None" = None
    did_you_mean: list[str] | None = None


@dataclass
class SearchOptions:
    language: str | None = None
    limit: int = 10
    operator: str = "and"
    boosts: dict[str, Any] | None = None  # {"fields": {...}, "terms": {...}}
    filters: dict[str, Any] | None = None
    facets: list[str] = field(default_factory=list)
    synonyms: bool = False
    synonym_weight: float = DEFAULT_SYNONYM_WEIGHT
    fuzzy: bool = False
    fuzzy_weight: float = DEFAULT_FUZZY_WEIGHT
    highlight: bool = False


@dataclass
class FacetResultValue:
    value: str
    count: int
    selected: bool


@dataclass
class FacetResult:
    values: list[FacetResultValue]
    separator: str | None = None


@dataclass
class FacetValuesOptions:
    filters: dict[str, Any] | None = None
