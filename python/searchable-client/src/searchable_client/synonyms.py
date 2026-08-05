"""Synonym expansion helpers for the search client (mirrors
packages/client/src/synonyms.ts).
"""

from searchable_client.types import SynonymShard


def _synonym_variants_for(term: str, synonym_shard: SynonymShard | None) -> list[str]:
    if synonym_shard is None:
        return []
    variants: set[str] = set()
    for group in synonym_shard.equivalences:
        if term in group:
            variants.update(v for v in group if v != term)
    variants.update(synonym_shard.directional.get(term, []))
    return list(variants)


def _multi_word_variants_for(
    normalized_phrase: str, synonym_shard: SynonymShard | None
) -> list[str]:
    """Every other normalized phrase `normalized_phrase` expands to via the
    synonym shard's `multiWord` equivalence classes (docs/guides/synonyms.md).
    Symmetric only, matching the TS `multiWordVariantsFor`."""
    if synonym_shard is None:
        return []
    variants: set[str] = set()
    for group in synonym_shard.multi_word:
        if normalized_phrase in group:
            variants.update(v for v in group if v != normalized_phrase)
    return list(variants)
