from dataclasses import dataclass
from typing import Any


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
