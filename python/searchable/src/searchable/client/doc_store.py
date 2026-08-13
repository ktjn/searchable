"""Doc-store entry fetching for exactly a set of ids, from whichever
doc shard(s) cover them (mirrors packages/client/src/doc-store.ts).
"""

from searchable.client.fetch import ShardCache, resolve_url
from searchable.client.types import DocStoreEntry, Manifest, doc_store_shard_from_dict


def _fetch_doc_store_entries_by_ids(
    manifest: Manifest, cache: ShardCache, base_url: str, ids: list[int]
) -> dict[int, DocStoreEntry]:
    doc_lookup: dict[int, DocStoreEntry] = {}
    id_set = set(ids)
    for entry in manifest.shards_docs:
        if not any(entry.id_range[0] <= i <= entry.id_range[1] for i in ids):
            continue
        shard = doc_store_shard_from_dict(cache.fetch_json(resolve_url(base_url, entry.file)))
        for doc_id, doc_entry in shard.items():
            if doc_id in id_set:
                doc_lookup[doc_id] = doc_entry
    return doc_lookup
