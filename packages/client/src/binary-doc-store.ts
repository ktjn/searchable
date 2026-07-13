import type { DocStoreEntry } from "@ktjn/searchable-format";
import { ByteReader } from "./byte-reader.js";

/**
 * Client-side decoder for the directory-based binary doc store shard
 * encoding (`packages/indexer/src/binary-doc-store.ts`). Deliberately
 * lazy: `decodeBinaryDocStoreDirectory()` parses only the sorted
 * docId -> (byte offset, byte length) table, and
 * `decodeBinaryDocStoreEntry()` decodes exactly one document's stored
 * fields by seeking directly to its byte range -- a query only ever
 * needs the specific hit ids on its result page (typically a handful),
 * never every document in the (today, corpus-wide single) doc store
 * shard.
 */

export interface BinaryDocStoreDirectory {
  /** Every doc id in this shard, sorted ascending. */
  sortedIds: number[];
  /** docId -> byte offset/length into the records blob (relative to `directoryByteLength`). */
  index: Map<number, { offset: number; length: number }>;
  /** Byte offset where the records blob begins. */
  directoryByteLength: number;
}

/** Decodes just the directory (every doc id + its byte range) -- no record bytes are touched. */
export function decodeBinaryDocStoreDirectory(
  bytes: Uint8Array,
): BinaryDocStoreDirectory {
  const r = new ByteReader(bytes, 0);
  const docCount = r.readVarint();
  const sortedIds: number[] = [];
  const index = new Map<number, { offset: number; length: number }>();
  let prevId = 0;
  for (let i = 0; i < docCount; i++) {
    prevId += r.readVarint();
    const id = prevId;
    const offset = r.readVarint();
    const length = r.readVarint();
    sortedIds.push(id);
    index.set(id, { offset, length });
  }
  return { sortedIds, index, directoryByteLength: r.position };
}

/** Decodes exactly one document's record by seeking directly to its byte range. */
export function decodeBinaryDocStoreEntry(
  bytes: Uint8Array,
  directoryByteLength: number,
  offset: number,
): DocStoreEntry {
  const r = new ByteReader(bytes, directoryByteLength + offset);
  const url = r.readString();
  const hasBoost = r.readVarint() === 1;
  const boost = hasBoost ? r.readFloat64() : undefined;
  const fieldCount = r.readVarint();
  const fields: Record<string, string> = {};
  for (let i = 0; i < fieldCount; i++) {
    const fieldName = r.readString();
    fields[fieldName] = r.readString();
  }
  return boost !== undefined ? { url, boost, fields } : { url, fields };
}
