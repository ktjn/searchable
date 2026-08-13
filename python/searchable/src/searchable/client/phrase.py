"""Phrase matching helpers for the search client (mirrors
packages/client/src/phrase.ts).
"""

from searchable.client.types import TermEntry


def _has_consecutive_positions(entries: list[TermEntry | None], doc_id: int) -> bool:
    postings = [
        next((p for p in e.postings if p.doc == doc_id), None) if e else None for e in entries
    ]
    if not postings or any(p is None for p in postings):
        return False
    first = postings[0]
    assert first is not None
    for field_name in first.fields:
        position_sets = [
            p.fields[field_name].pos if p is not None and field_name in p.fields else None
            for p in postings
        ]
        if any(s is None for s in position_sets):
            continue
        start_positions = position_sets[0]
        assert start_positions is not None
        for start in start_positions:
            if all(start + i in (position_sets[i] or []) for i in range(1, len(position_sets))):
                return True
    return False


def _contains_phrase(query_tokens: list[str], phrase_tokens: list[str]) -> bool:
    if not phrase_tokens or len(phrase_tokens) > len(query_tokens):
        return False
    for i in range(len(query_tokens) - len(phrase_tokens) + 1):
        if all(query_tokens[i + j] == t for j, t in enumerate(phrase_tokens)):
            return True
    return False
