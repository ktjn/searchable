from dataclasses import dataclass, field
from typing import Any


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
    format: str | None = None


@dataclass(frozen=True)
class DocsShardEntry:
    shard: int
    file: str
    id_range: tuple[int, int]
    format: str | None = None


@dataclass(frozen=True)
class FacetShardEntry:
    field: str
    file: str


@dataclass(frozen=True)
class FuzzyManifestEntry:
    file: str
    format: str | None = None


@dataclass(frozen=True)
class VectorManifest:
    dims: int
    quantization: str
    embedding_provider: dict[str, Any]
    shards: dict[str, str]


@dataclass(frozen=True)
class Manifest:
    version: int
    build_id: str
    format: str
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
    vectors: VectorManifest | None = None


def manifest_from_dict(data: dict[str, Any]) -> Manifest:
    shards = data["shards"]
    return Manifest(
        version=data["version"],
        build_id=data["buildId"],
        format=data["format"],
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
                format=t.get("format"),
            )
            for t in shards.get("terms", [])
        ],
        shards_docs=[
            DocsShardEntry(
                shard=d["shard"],
                file=d["file"],
                id_range=(d["idRange"][0], d["idRange"][1]),
                format=d.get("format"),
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
                lang: FuzzyManifestEntry(file=v["file"], format=v.get("format"))
                for lang, v in data["fuzzy"].items()
            }
            if data.get("fuzzy") is not None
            else None
        ),
        vectors=(
            VectorManifest(
                dims=data["vectors"]["dims"],
                quantization=data["vectors"]["quantization"],
                embedding_provider=dict(data["vectors"]["embeddingProvider"]),
                shards=dict(data["vectors"]["shards"]),
            )
            if data.get("vectors") is not None
            else None
        ),
    )


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


@dataclass(frozen=True)
class VectorEntry:
    passage_id: str
    doc_id: int
    vector: list[float]


@dataclass(frozen=True)
class VectorShard:
    dims: int
    quantization: str
    quant_range: tuple[float, float] | None
    entries: list[VectorEntry]


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


def vector_shard_from_dict(data: dict[str, Any]) -> VectorShard:
    quant_range = data.get("quantRange")
    return VectorShard(
        dims=data["dims"],
        quantization=data["quantization"],
        quant_range=(float(quant_range["min"]), float(quant_range["max"]))
        if quant_range is not None
        else None,
        entries=[
            VectorEntry(
                passage_id=entry["passageId"],
                doc_id=entry["docId"],
                vector=[float(value) for value in entry["vector"]],
            )
            for entry in data["entries"]
        ],
    )
