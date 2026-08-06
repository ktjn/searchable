"""Fuzzy (SymSpell deletion-dictionary) query expansion for the search
client (mirrors packages/client/src/fuzzy.ts).
"""

import sys

from searchable_analysis import generate_deletes
from searchable_binary import decode_binary_fuzzy_entry, decode_binary_fuzzy_shard_directory

from searchable_client.fetch import ShardCache, resolve_url
from searchable_client.types import Manifest, fuzzy_shard_from_dict


def _levenshtein_distance(a: str, b: str) -> int:
    s, t = list(a), list(b)
    prev_row = list(range(len(t) + 1))
    for i in range(1, len(s) + 1):
        diag = prev_row[0]
        prev_row[0] = i
        for j in range(1, len(t) + 1):
            temp = prev_row[j]
            prev_row[j] = (
                diag if s[i - 1] == t[j - 1] else 1 + min(diag, prev_row[j], prev_row[j - 1])
            )
            diag = temp
    return prev_row[len(t)]


MAX_FUZZY_CANDIDATES_PER_TERM = 200


class _FuzzyLookup:
    def __init__(self, max_edits: int, deletions: dict[str, list[str]]):
        self.max_edits = max_edits
        self._deletions = deletions

    def get(self, variant: str) -> list[str]:
        return self._deletions.get(variant, [])


class _BinaryFuzzyLookup(_FuzzyLookup):
    """Lazy binary-shard lookup: decodes just the requested deletion
    variant's entry from an already-fetched byte buffer (previously a
    nested class inside `_load_fuzzy_lookup`)."""

    def __init__(
        self, max_edits: int, data: bytes, index: dict[str, tuple[int, int]], dir_len: int
    ) -> None:
        self.max_edits = max_edits
        self._data = data
        self._index = index
        self._dir_len = dir_len

    def get(self, variant: str) -> list[str]:
        location = self._index.get(variant)
        return decode_binary_fuzzy_entry(self._data, self._dir_len, location[0]) if location else []


def _fuzzy_candidates_for(term: str, lookup: "_FuzzyLookup | None") -> list[tuple[str, int]]:
    if lookup is None:
        return []
    candidates: set[str] = set(lookup.get(term))
    for deletion in generate_deletes(term, lookup.max_edits):
        candidates.update(lookup.get(deletion))
    candidate_terms = list(candidates)
    if len(candidate_terms) > MAX_FUZZY_CANDIDATES_PER_TERM:
        # Mirror the TS client's console.warn: candidates beyond the cap are
        # dropped before scoring (bounds worst-case per-term CPU), and which
        # ones survive depends on set insertion order, not distance.
        print(
            f'[searchable-client] fuzzy lookup for "{term}" found '
            f"{len(candidate_terms)} dictionary candidates, over the "
            f"{MAX_FUZZY_CANDIDATES_PER_TERM}-candidate cap -- scoring only the first "
            f"{MAX_FUZZY_CANDIDATES_PER_TERM} (not necessarily the closest). "
            "A dense vocabulary this large may want a shorter query term, a smaller "
            "fuzzyMaxEdits, or this project's benchmarking data to size the tradeoff "
            "(docs/project/governance.md).",
            file=sys.stderr,
        )
        candidate_terms = candidate_terms[:MAX_FUZZY_CANDIDATES_PER_TERM]
    return [(c, _levenshtein_distance(term, c)) for c in candidate_terms if c != term]


def _effective_max_edits(term: str, shard_max_edits: int) -> int:
    return min(1, shard_max_edits) if len(term) <= 3 else shard_max_edits


def _fuzzy_matches_for(term: str, lookup: "_FuzzyLookup | None") -> list[tuple[str, int]]:
    if lookup is None:
        return []
    cap = _effective_max_edits(term, lookup.max_edits)
    return [m for m in _fuzzy_candidates_for(term, lookup) if m[1] <= cap]


def _nearest_terms_for(term: str, lookup: "_FuzzyLookup | None", limit: int) -> list[str]:
    matches = sorted(_fuzzy_candidates_for(term, lookup), key=lambda m: (m[1], m[0]))
    return [m[0] for m in matches[:limit]]


def _load_fuzzy_lookup(
    manifest: Manifest, cache: ShardCache, base_url: str, language: str
) -> "_FuzzyLookup | None":
    entry = (manifest.fuzzy or {}).get(language)
    if entry is None:
        return None
    if entry.format == "binary":
        data = cache.fetch_bytes(resolve_url(base_url, entry.file))
        max_edits, _, index, dir_len = decode_binary_fuzzy_shard_directory(data)

        return _BinaryFuzzyLookup(max_edits, data, index, dir_len)
    shard = fuzzy_shard_from_dict(cache.fetch_json(resolve_url(base_url, entry.file)))
    return _FuzzyLookup(shard.max_edits, shard.deletions)
