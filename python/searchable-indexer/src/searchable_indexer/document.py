import hashlib
import json
from dataclasses import dataclass, field

JsonValue = None | bool | int | float | str | list["JsonValue"] | dict[str, "JsonValue"]


@dataclass(frozen=True, slots=True)
class FieldDefinition:
    indexed: bool = True
    stored: bool = False
    boost: float = 1.0


@dataclass(slots=True)
class IndexDocument:
    id: int
    external_id: str | None = None
    url: str = ""
    language: str = "en"
    indexed_fields: dict[str, str] = field(default_factory=dict)
    stored_fields: dict[str, str] = field(default_factory=dict)
    metadata: dict[str, JsonValue] = field(default_factory=dict)
    boost: float = 1.0


def compute_content_hash(document: IndexDocument) -> str:
    # Precondition: document.metadata/document.boost must already be validated
    # JSON-compatible/finite (see build_index.py's _validate_index_document) --
    # allow_nan=False below assumes that and will raise ValueError otherwise.
    # id/external_id/url are deliberately excluded: they're identity/location,
    # not content (docs/superpowers/specs/2026-07-30-structured-document-indexing-design.md).
    hash_input = {
        "indexedFields": document.indexed_fields,
        "storedFields": document.stored_fields,
        "metadata": document.metadata,
        "language": document.language,
        "boost": document.boost,
    }
    canonical = json.dumps(
        hash_input,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()
