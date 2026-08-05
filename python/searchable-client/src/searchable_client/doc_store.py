"""Doc-store entry fetching for exactly a set of ids, from whichever
doc shard(s) cover them (mirrors packages/client/src/doc-store.ts).
"""

from searchable_client.fetch import ShardCache, resolve_url
from searchable_client.types import DocStoreEntry, Manifest, doc_store_shard_from_dict


def _fetch_doc_store_entries_by_ids(
    manifest: Manifest, cache: ShardCache, base_url: str, ids: list[int]
) -> dict[int, DocStoreEntry]:
    doc_lookup: dict[int, DocStoreEntry] = {}
    id_set = set(ids)
    for entry in manifest.shards_docs:
        if not any(entry.id_range[0] <= i <= entry.id_range[1] for i in ids):
            continue
        if entry.format == "binary":
            from searchable_client.binary_doc_store import (
                decode_binary_doc_store_directory,
                decode_binary_doc_store_entry,
            )

            data = cache.fetch_bytes(resolve_url(base_url, entry.file))
            _, index, dir_len = decode_binary_doc_store_directory(
                data, binary_version=entry.binary_version
            )
            for doc_id in id_set:
                location = index.get(doc_id)
                if location:
                    doc_lookup[doc_id] = decode_binary_doc_store_entry(
                        data, dir_len, location[0], binary_version=entry.binary_version or 1
                    )
        else:
            shard = doc_store_shard_from_dict(cache.fetch_json(resolve_url(base_url, entry.file)))
            for doc_id, doc_entry in shard.items():
                if doc_id in id_set:
                    doc_lookup[doc_id] = doc_entry
    return doc_lookup
