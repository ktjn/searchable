import type { ByteReader } from "./byte-reader.js";

export interface DirectoryEntry {
  offset: number;
  length: number;
}

/**
 * Reads `count` `{key, offset, length}` directory entries from `r`,
 * returning the keys in file order plus an offset/length index. Every
 * directory-based binary shard (`binary-term-shard.ts`,
 * `binary-fuzzy-shard.ts`, `binary-doc-store.ts`) shares this layout;
 * only the key stream differs (raw string vs delta-encoded id), supplied
 * via `readKey`.
 */
export function decodeDirectory<K>(
  r: ByteReader,
  count: number,
  readKey: (reader: ByteReader) => K,
): { keys: K[]; index: Map<K, DirectoryEntry> } {
  const keys: K[] = [];
  const index = new Map<K, DirectoryEntry>();
  for (let i = 0; i < count; i++) {
    const key = readKey(r);
    const offset = r.readVarint();
    const length = r.readVarint();
    keys.push(key);
    index.set(key, { offset, length });
  }
  return { keys, index };
}
