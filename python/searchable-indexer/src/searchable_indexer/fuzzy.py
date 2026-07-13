# Direct port of packages/indexer/src/build-index.ts's
# buildFuzzyShard / generateDeletes -- a SymSpell-style deletion
# dictionary: every string reachable by deleting up to max_edits
# Unicode code points from a term (plus the term itself, 0 deletions).


def _generate_deletes(term: str, max_edits: int) -> set[str]:
    frontier = {term}
    all_variants = set(frontier)
    for _ in range(max_edits):
        next_frontier: set[str] = set()
        for variant in frontier:
            chars = list(variant)
            for i in range(len(chars)):
                next_frontier.add("".join(chars[:i] + chars[i + 1 :]))
        all_variants |= next_frontier
        frontier = next_frontier
    return all_variants


def build_fuzzy_shard(term_shard: dict, max_edits: int) -> dict:
    deletion_sets: dict[str, set[str]] = {}
    for term in term_shard:
        for variant in _generate_deletes(term, max_edits):
            deletion_sets.setdefault(variant, set()).add(term)

    deletions = {variant: sorted(terms) for variant, terms in deletion_sets.items()}
    return {"maxEdits": max_edits, "deletions": deletions}
