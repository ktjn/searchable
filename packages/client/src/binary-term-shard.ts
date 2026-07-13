import type { TermEntry } from "@csf/format";
import { ByteReader } from "./byte-reader.js";

/**
 * Client-side decoder for the directory-based binary term shard
 * encoding (`packages/indexer/src/binary-term-shard.ts`, docs/archive/specs/binary-format.md#dictionary-encoding
 * / #posting-encoding, docs/concepts/binary-storage.md). Deliberately
 * lazy: `decodeDirectory()` parses only the sorted term -> (byte
 * offset, byte length) table, never touching a posting byte, and
 * `decodeTermEntry()` decodes exactly one term's postings by seeking
 * directly to its byte range. The archived binary-vs-JSON investigation
 * found this consistently faster than parsing the equivalent whole JSON
 * shard for a typical few-term query, and slower or a wash when the
 * whole binary shard was decoded up front.
 */

export interface BinaryTermShardDirectory {
  /** Every term in this shard, sorted ascending -- enables a prefix-range binary search without decoding any postings. */
  sortedTerms: string[];
  /** term -> byte offset/length into the postings blob (relative to `directoryByteLength`). */
  index: Map<string, { offset: number; length: number }>;
  /** Byte offset where the postings blob begins -- add to a directory entry's `offset` to get its absolute position. */
  directoryByteLength: number;
}

/** Decodes just the directory (every term name + its byte range) -- no posting bytes are touched. */
export function decodeBinaryTermShardDirectory(
  bytes: Uint8Array,
): BinaryTermShardDirectory {
  const r = new ByteReader(bytes, 0);
  const termCount = r.readVarint();
  const sortedTerms: string[] = [];
  const index = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < termCount; i++) {
    const term = r.readString();
    const offset = r.readVarint();
    const length = r.readVarint();
    sortedTerms.push(term);
    index.set(term, { offset, length });
  }
  return { sortedTerms, index, directoryByteLength: r.position };
}

/** Decodes one term's postings by seeking directly to its byte range -- never touches any other term. */
export function decodeBinaryTermEntry(
  bytes: Uint8Array,
  directoryByteLength: number,
  offset: number,
): TermEntry {
  const r = new ByteReader(bytes, directoryByteLength + offset);
  const df = r.readVarint();
  const postingCount = r.readVarint();
  const postings: TermEntry["postings"] = [];
  let prevDoc = 0;
  for (let j = 0; j < postingCount; j++) {
    prevDoc += r.readVarint();
    const doc = prevDoc;
    const hasBoost = r.readVarint() === 1;
    const boost = hasBoost ? r.readFloat64() : undefined;
    const fieldCount = r.readVarint();
    const fields: TermEntry["postings"][number]["fields"] = {};
    for (let k = 0; k < fieldCount; k++) {
      const fieldName = r.readString();
      const tf = r.readVarint();
      const len = r.readVarint();
      const posCount = r.readVarint();
      const pos: number[] = [];
      let prevPos = 0;
      for (let p = 0; p < posCount; p++) {
        prevPos += r.readVarint();
        pos.push(prevPos);
      }
      fields[fieldName] = { tf, pos, len };
    }
    postings.push(
      boost !== undefined ? { doc, boost, fields } : { doc, fields },
    );
  }
  return { df, postings };
}

/**
 * Every term in `sortedTerms` that starts with `prefix`, found via
 * binary search over the sorted array (`docs/concepts/index-format.md#size-targets-and-sharding-tuning`'s
 * "contiguous range scan over a sorted structure" note) rather than a
 * linear scan -- the whole point of storing terms sorted in the
 * directory.
 */
export function termsWithBinaryPrefix(
  sortedTerms: string[],
  prefix: string,
): string[] {
  // First index >= prefix.
  let lo = 0;
  let hi = sortedTerms.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sortedTerms[mid] ?? "") < prefix) lo = mid + 1;
    else hi = mid;
  }
  const start = lo;
  const result: string[] = [];
  for (let i = start; i < sortedTerms.length; i++) {
    const term = sortedTerms[i];
    if (term === undefined || !term.startsWith(prefix)) break;
    result.push(term);
  }
  return result;
}
