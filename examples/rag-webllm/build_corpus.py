"""Chunks content/tinyshakespeare.txt and builds a real `searchable` static
index over it, using this repo's own Python indexer -- the same one that
powers the showcase's product-catalog demo.

Run via build.sh, or directly:
  uv run --project python/searchable python examples/rag-webllm/build_corpus.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from searchable.indexer.build_index import build_index_documents
from searchable.indexer.document import FieldDefinition, IndexDocument
from searchable.indexer.write_index import write_index

HERE = Path(__file__).parent
SOURCE_TXT = HERE / "content" / "tinyshakespeare.txt"
OUT_DIR = HERE / "search-index"
CHUNKS_JSON = HERE / "chunks.json"

TARGET_CHUNK_CHARS = 900

# "title"/"body" carry the searchable text; "chunkText" is the stored,
# verbatim passage a hit returns to the client (docs/guides/facets.md's
# searchable-stored-<field> mechanism, used here via build_index_documents
# instead of a meta tag since these are synthetic chunks, not real pages).
FIELD_DEFINITIONS = {
    "title": FieldDefinition(indexed=True, stored=True, boost=2.0),
    "body": FieldDefinition(indexed=True, stored=False, boost=1.0),
    "chunkText": FieldDefinition(indexed=False, stored=True),
    "speakers": FieldDefinition(indexed=False, stored=True),
}


def parse_turns(text: str) -> list[tuple[str, str]]:
    """Splits the raw file into (speaker, spoken_text) turns. Each turn is a
    blank-line-separated block whose first line is "Speaker:" and whose
    remaining lines are what they say."""
    turns: list[tuple[str, str]] = []
    for block in text.split("\n\n"):
        lines = [line.strip() for line in block.strip().splitlines() if line.strip()]
        if len(lines) < 2:
            continue
        speaker_line = lines[0]
        if not speaker_line.endswith(":"):
            continue
        speaker = speaker_line[:-1].strip()
        spoken = " ".join(lines[1:])
        if speaker and spoken:
            turns.append((speaker, spoken))
    return turns


def group_into_chunks(turns: list[tuple[str, str]]) -> list[dict]:
    """Groups consecutive turns into ~TARGET_CHUNK_CHARS-sized passages,
    never splitting a turn across chunks."""
    chunks: list[dict] = []
    current: list[tuple[str, str]] = []
    current_len = 0
    for speaker, spoken in turns:
        turn_len = len(speaker) + len(spoken) + 4
        if current and current_len + turn_len > TARGET_CHUNK_CHARS:
            chunks.append(_finalize_chunk(current))
            current = []
            current_len = 0
        current.append((speaker, spoken))
        current_len += turn_len
    if current:
        chunks.append(_finalize_chunk(current))
    return chunks


def _finalize_chunk(turns: list[tuple[str, str]]) -> dict:
    speakers = list(dict.fromkeys(speaker for speaker, _ in turns))
    body = "\n".join(f"{speaker}: {spoken}" for speaker, spoken in turns)
    title = f"{speakers[0]}" + (f" & {speakers[1]}" if len(speakers) > 1 else "")
    if len(speakers) > 2:
        title += f" (+{len(speakers) - 2} more)"
    return {"speakers": speakers, "title": title, "body": body}


def main() -> None:
    if not SOURCE_TXT.exists():
        print(f"missing {SOURCE_TXT} -- see README.md", file=sys.stderr)
        sys.exit(1)

    text = SOURCE_TXT.read_text(encoding="utf-8")
    turns = parse_turns(text)
    chunks = group_into_chunks(turns)
    print(f"{len(turns)} dialogue turns -> {len(chunks)} chunks", file=sys.stderr)

    documents: list[IndexDocument] = []
    chunk_records: dict[str, dict] = {}
    for i, chunk in enumerate(chunks):
        url = f"/chunk/{i:05d}.html"
        documents.append(
            IndexDocument(
                id=i,
                url=url,
                indexed_fields={"title": chunk["title"], "body": chunk["body"]},
                stored_fields={
                    "title": chunk["title"],
                    "chunkText": chunk["body"],
                    "speakers": ", ".join(chunk["speakers"]),
                },
            )
        )
        chunk_records[str(i)] = chunk

    built = build_index_documents(documents, field_definitions=FIELD_DEFINITIONS)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_index(built, str(OUT_DIR))
    CHUNKS_JSON.write_text(json.dumps(chunk_records, indent=0), encoding="utf-8")
    print(f"wrote index -> {OUT_DIR}", file=sys.stderr)
    print(f"wrote chunk records -> {CHUNKS_JSON}", file=sys.stderr)


if __name__ == "__main__":
    main()
