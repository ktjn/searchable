import type { TermEntry } from "@csf/format";

/**
 * Client-side decoder for the directory-based binary term shard
 * encoding (`packages/indexer/src/binary-term-shard.ts`, docs/spec-binary-format.md#dictionary-encoding
 * / #posting-encoding, docs/11-binary-vs-json-index.md). Deliberately
 * lazy: `decodeDirectory()` parses only the sorted term -> (byte
 * offset, byte length) table, never touching a posting byte, and
 * `decodeTermEntry()` decodes exactly one term's postings by seeking
 * directly to its byte range -- this is the design
 * `packages/indexer/bench/binary-lazy-decode.mjs` validated as
 * consistently faster than `JSON.parse`-ing the equivalent whole JSON
 * shard for a typical few-term query, and consistently slower (or a
 * wash) if the whole shard were decoded up front instead.
 */

class ByteReader {
  #view: Uint8Array;
  #pos: number;
  constructor(bytes: Uint8Array, startPos = 0) {
    this.#view = bytes;
    this.#pos = startPos;
  }

  get position(): number {
    return this.#pos;
  }

  readVarint(): number {
    let result = 0;
    let shift = 1;
    for (;;) {
      const byte = this.#view[this.#pos++];
      if (byte === undefined) {
        throw new Error(
          "unexpected end of binary term shard while reading varint",
        );
      }
      result += (byte & 0x7f) * shift;
      if ((byte & 0x80) === 0) return result;
      shift *= 128;
    }
  }

  readBytes(length: number): Uint8Array {
    const out = this.#view.subarray(this.#pos, this.#pos + length);
    this.#pos += length;
    return out;
  }

  readString(): string {
    const length = this.readVarint();
    return new TextDecoder().decode(this.readBytes(length));
  }

  readFloat64(): number {
    const value = new DataView(
      this.#view.buffer,
      this.#view.byteOffset + this.#pos,
      8,
    ).getFloat64(0, true);
    this.#pos += 8;
    return value;
  }
}

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
 * binary search over the sorted array (`docs/02-index-format.md#size-targets--sharding-tuning`'s
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
