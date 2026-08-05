import type { DocStoreEntry, Manifest } from "@ktjn/searchable-format";
import {
  decodeBinaryDocStoreDirectory,
  decodeBinaryDocStoreEntry,
} from "./binary-doc-store.js";
import type { ShardCache } from "./fetch-json.js";
import type { Hit } from "./search.js";
import { resolve } from "./url.js";

/**
 * Fetches doc-store entries for exactly the given ids, from whichever
 * doc shard(s) cover them — shared by `lexicalSearch`'s inline hit
 * assembly and vector/hybrid result assembly (which builds its hit list
 * from a different candidate set). A binary-format shard
 * (`./binary-doc-store.js`) decodes only the requested ids by seeking
 * directly to each one's byte range, never the whole store — the only
 * doc store shard today covers the *entire* corpus regardless of size
 * (`write-index.ts` always emits one `docs/0.json`), so this is a real
 * win any time a query's hit count is a small fraction of the corpus. A
 * JSON-format shard still parses in full (as before), same as term
 * shards' own JSON path — `JSON.parse` has no partial-decode option.
 */
export async function fetchDocStoreEntriesByIds(
  manifest: Manifest,
  cache: ShardCache,
  baseUrl: string,
  ids: number[],
): Promise<Map<number, DocStoreEntry>> {
  const docShardEntries = manifest.shards.docs.filter((d) =>
    ids.some((id) => id >= d.idRange[0] && id <= d.idRange[1]),
  );
  const idSet = new Set(ids);
  const docLookup = new Map<number, DocStoreEntry>();
  await Promise.all(
    docShardEntries.map(async (entry) => {
      if (entry.format === "binary") {
        const bytes = await cache.fetchArrayBuffer(
          resolve(baseUrl, entry.file),
        );
        const directory = decodeBinaryDocStoreDirectory(
          bytes,
          entry.binaryVersion,
        );
        for (const id of idSet) {
          const location = directory.index.get(id);
          if (!location) continue;
          docLookup.set(
            id,
            decodeBinaryDocStoreEntry(
              bytes,
              directory.directoryByteLength,
              location.offset,
              entry.binaryVersion ?? 1,
            ),
          );
        }
      } else {
        const shard = await cache.fetchJson<Record<string, DocStoreEntry>>(
          resolve(baseUrl, entry.file),
        );
        for (const [id, docEntry] of Object.entries(shard)) {
          docLookup.set(Number(id), docEntry);
        }
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
