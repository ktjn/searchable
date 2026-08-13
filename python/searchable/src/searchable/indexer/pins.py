# Direct port of packages/indexer/src/build-index.ts's resolvePins:
# applies the priority -> doc-boost -> insertion-order tie-break from
# docs/guides/pinning.md#conflicting-pins.

from typing import Any


def resolve_pins(
    pins_acc_by_language: dict[str, dict[str, dict[str, Any]]],
) -> tuple[dict[str, dict[str, Any]], list[str]]:
    pins_shards: dict[str, dict[str, Any]] = {}
    warnings: list[str] = []

    for language, pins_acc in pins_acc_by_language.items():
        pins_shard: dict[str, dict[str, Any]] = {}
        for phrase, acc in pins_acc.items():
            # Python's sorted() is stable (Timsort), matching the TS
            # original's reliance on Array#sort's ES2019-guaranteed
            # stability for the insertion-order tie-break.
            sorted_docs = sorted(acc["docs"], key=lambda d: (-d["priority"], -d["boost"]))
            # dict.fromkeys preserves first-occurrence order (matching
            # JS Set iteration order), not numeric order -- the warning
            # message lists doc ids in priority/boost/build order, same
            # as the TS original.
            distinct_doc_ids = list(dict.fromkeys(d["id"] for d in sorted_docs))
            if len(distinct_doc_ids) > 1:
                ids_str = ", ".join(str(i) for i in distinct_doc_ids)
                warnings.append(
                    f'pin conflict: "{phrase}" ({language}) is pinned by '
                    f"{len(distinct_doc_ids)} pages (doc ids {ids_str}) -- "
                    "resolved by priority/boost/build order; see "
                    "docs/guides/pinning.md#conflicting-pins"
                )
            pins_shard[phrase] = {
                "mode": acc["mode"],
                "docs": [
                    {
                        "id": d["id"],
                        "priority": d["priority"],
                        "exclusive": d["exclusive"],
                    }
                    for d in sorted_docs
                ],
            }
        pins_shards[language] = pins_shard

    return pins_shards, warnings
