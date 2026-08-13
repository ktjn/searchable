import type { ShardCache } from "./fetch-json.js";
import type { DocStoreEntry, Manifest } from "./format/index.js";
import type { Hit } from "./search.js";
import { resolve } from "./url.js";

export async function fetchDocStoreEntriesByIds(
  manifest: Manifest,
  cache: ShardCache,
  baseUrl: string,
  ids: number[],
): Promise<Map<number, DocStoreEntry>> {
  const docShardEntries = manifest.shards.docs.filter((d) =>
    ids.some((id) => id >= d.idRange[0] && id <= d.idRange[1]),
  );
  const docLookup = new Map<number, DocStoreEntry>();
  await Promise.all(
    docShardEntries.map(async (entry) => {
      const shard = await cache.fetchJson<Record<string, DocStoreEntry>>(
        resolve(baseUrl, entry.file),
      );
      for (const [id, docEntry] of Object.entries(shard)) {
        docLookup.set(Number(id), docEntry);
      }
    }),
  );
  return docLookup;
}

export function docStoreEntryToHit(
  id: number,
  score: number,
  doc?: DocStoreEntry,
): Hit {
  return { id, score, url: doc?.url ?? "", fields: doc?.fields ?? {} };
}
