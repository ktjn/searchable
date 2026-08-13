"""Posting-list building for the index builder. Shares the same
term/posting shape (`df` + per-field `tf`/`pos`/`len` in place) the
index format documents.
"""

from typing import Any

from searchable.analysis import Token


def add_postings(
    shard: dict[str, Any],
    posting_index: dict[str, dict[int, Any]],
    field_name: str,
    doc_id: int,
    doc_boost: float,
    tokens: list[Token],
) -> None:
    field_length = len(tokens)
    positions_by_term: dict[str, list[int]] = {}
    for token in tokens:
        positions_by_term.setdefault(token.term, []).append(token.position)

    for term, positions in positions_by_term.items():
        entry = shard.setdefault(term, {"df": 0, "postings": []})
        doc_index = posting_index.setdefault(term, {})
        posting = doc_index.get(doc_id)
        if posting is None:
            posting = {"doc": doc_id, "fields": {}}
            if doc_boost != 1.0:
                posting["boost"] = doc_boost
            entry["postings"].append(posting)
            entry["df"] += 1
            doc_index[doc_id] = posting
        posting["fields"][field_name] = {
            "tf": len(positions),
            "pos": positions,
            "len": field_length,
        }
