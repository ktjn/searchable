# Direct port of packages/indexer/src/build-index.ts's buildFuzzyShard --
# a SymSpell-style deletion dictionary: every string reachable by deleting up
# to max_edits Unicode code points from a term (plus the term itself, 0
# deletions). The per-term deletion generation is shared with the runtime via
# searchable_analysis.generate_deletes rather than forked here.

from typing import Any

from searchable_analysis import generate_deletes


def build_fuzzy_shard(term_shard: dict[str, Any], max_edits: int) -> dict[str, Any]:
    deletion_sets: dict[str, set[str]] = {}
    for term in term_shard:
        for variant in generate_deletes(term, max_edits):
            deletion_sets.setdefault(variant, set()).add(term)

    deletions = {variant: sorted(terms) for variant, terms in deletion_sets.items()}
    return {"maxEdits": max_edits, "deletions": deletions}
