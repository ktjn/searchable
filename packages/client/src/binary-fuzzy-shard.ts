import { ByteReader } from "./byte-reader.js";

/**
 * Client-side decoder for the directory-based binary fuzzy shard
 * encoding (`packages/indexer/src/binary-fuzzy-shard.ts`). Deliberately
 * lazy, same design as `binary-term-shard.ts`: `decodeBinaryFuzzyShardDirectory()`
 * parses only the sorted deletion-variant -> (byte offset, byte length)
 * table, and `decodeBinaryFuzzyEntry()` decodes exactly one variant's
 * real-term list by seeking directly to its byte range -- a query only
 * ever needs the handful of deletion-variant keys its own query terms'
 * `generateDeletes()` expansion produces, never the whole dictionary.
 */

export interface BinaryFuzzyShardDirectory {
  maxEdits: 1 | 2;
  /** Every deletion-variant key in this shard, sorted ascending. */
  sortedVariants: string[];
  /** variant -> byte offset/length into the deletions blob (relative to `directoryByteLength`). */
  index: Map<string, { offset: number; length: number }>;
  /** Byte offset where the deletions blob begins. */
  directoryByteLength: number;
}

/** Decodes the header + directory (every variant + its byte range) -- no deletion-list bytes are touched. */
export function decodeBinaryFuzzyShardDirectory(
  bytes: Uint8Array,
): BinaryFuzzyShardDirectory {
  const r = new ByteReader(bytes, 0);
  const maxEdits = r.readVarint() as 1 | 2;
  const variantCount = r.readVarint();
  const sortedVariants: string[] = [];
  const index = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < variantCount; i++) {
    const variant = r.readString();
    const offset = r.readVarint();
    const length = r.readVarint();
    sortedVariants.push(variant);
    index.set(variant, { offset, length });
  }
  return { maxEdits, sortedVariants, index, directoryByteLength: r.position };
}

/** Decodes one deletion-variant's real-term list by seeking directly to its byte range. */
export function decodeBinaryFuzzyEntry(
  bytes: Uint8Array,
  directoryByteLength: number,
  offset: number,
): string[] {
  const r = new ByteReader(bytes, directoryByteLength + offset);
  const termCount = r.readVarint();
  const terms: string[] = [];
  for (let i = 0; i < termCount; i++) terms.push(r.readString());
  return terms;
}
