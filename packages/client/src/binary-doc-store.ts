import type { DocStoreEntry, JsonValue } from "@ktjn/searchable-format";
import { decodeDirectory } from "./binary-directory.js";
import { ByteReader } from "./byte-reader.js";

const STRUCTURED_MAGIC = new Uint8Array([0x53, 0x44, 0x4f, 0x43]);
const STRUCTURED_VERSION = 2;

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
  binaryVersion?: number,
): BinaryDocStoreDirectory {
  const headerLength = structuredHeaderLength(bytes, binaryVersion);
  const r = new ByteReader(bytes, headerLength);
  const docCount = r.readVarint();
  let prevId = 0;
  const { keys: sortedIds, index } = decodeDirectory(r, docCount, (reader) => {
    prevId += reader.readVarint();
    return prevId;
  });
  const recordsLength = bytes.length - r.position;
  for (const { offset, length } of index.values()) {
    if (offset + length > recordsLength) {
      throw new Error("binary document-store record exceeds shard bounds");
    }
  }
  return { sortedIds, index, directoryByteLength: r.position };
}

/** Decodes exactly one document's record by seeking directly to its byte range. */
export function decodeBinaryDocStoreEntry(
  bytes: Uint8Array,
  directoryByteLength: number,
  offset: number,
  binaryVersion = 1,
): DocStoreEntry {
  const r = new ByteReader(bytes, directoryByteLength + offset);
  if (binaryVersion === 2) {
    assertMagic(r);
    const version = r.readVarint();
    if (version !== STRUCTURED_VERSION) {
      throw new Error(`unsupported binary document-store version: ${version}`);
    }
    const url = r.readString();
    const flags = r.readVarint();
    if ((flags & ~0x0f) !== 0) {
      throw new Error(`unsupported structured binary document flags: ${flags}`);
    }
    const boost = flags & 1 ? r.readFloat64() : undefined;
    const externalId = flags & 2 ? r.readString() : undefined;
    const contentHash = flags & 4 ? r.readString() : undefined;
    const metadata = flags & 8 ? readStructuredJsonValue(r) : undefined;
    const fields = readFields(r);
    const entry: DocStoreEntry = { url, fields };
    if (boost !== undefined) entry.boost = boost;
    if (externalId !== undefined) entry.externalId = externalId;
    if (contentHash !== undefined) entry.contentHash = contentHash;
    if (metadata !== undefined) entry.metadata = metadata;
    return entry;
  }
  if (binaryVersion !== 1) {
    throw new Error(
      `unsupported binary document-store version: ${binaryVersion}`,
    );
  }
  const url = r.readString();
  const hasBoost = r.readVarint() === 1;
  const boost = hasBoost ? r.readFloat64() : undefined;
  const fields = readFields(r);
  return boost !== undefined ? { url, boost, fields } : { url, fields };
}

function structuredHeaderLength(
  bytes: Uint8Array,
  binaryVersion?: number,
): number {
  const inferred = hasMagic(bytes) ? STRUCTURED_VERSION : 1;
  const version = binaryVersion ?? inferred;
  if (version === 1) return 0;
  if (version !== STRUCTURED_VERSION) {
    throw new Error(`unsupported binary document-store version: ${version}`);
  }
  const r = new ByteReader(bytes, 0);
  assertMagic(r);
  const encodedVersion = r.readVarint();
  if (encodedVersion !== STRUCTURED_VERSION) {
    throw new Error(
      `unsupported binary document-store version: ${encodedVersion}`,
    );
  }
  return r.position;
}

function hasMagic(bytes: Uint8Array): boolean {
  return STRUCTURED_MAGIC.every((value, index) => bytes[index] === value);
}

function assertMagic(reader: ByteReader): void {
  const magic = reader.readBytes(STRUCTURED_MAGIC.length);
  if (!hasMagic(magic)) {
    throw new Error("invalid structured binary document-store magic");
  }
}

function readFields(reader: ByteReader): Record<string, string> {
  const fieldCount = reader.readVarint();
  const fields: Record<string, string> = {};
  for (let i = 0; i < fieldCount; i++) {
    const fieldName = reader.readString();
    fields[fieldName] = reader.readString();
  }
  return fields;
}

function readStructuredJsonValue(reader: ByteReader): JsonValue {
  const tag = reader.readVarint();
  if (tag === 0) return null;
  if (tag === 1) return false;
  if (tag === 2) return true;
  if (tag === 3) {
    const value = reader.readFloat64();
    if (!Number.isFinite(value)) {
      throw new Error("structured binary metadata number must be finite");
    }
    return value;
  }
  if (tag === 4) return reader.readString();
  if (tag === 5) {
    return Array.from({ length: reader.readVarint() }, () =>
      readStructuredJsonValue(reader),
    );
  }
  if (tag === 6) {
    const object: Record<string, JsonValue> = {};
    const count = reader.readVarint();
    for (let i = 0; i < count; i++) {
      const key = reader.readString();
      if (Object.hasOwn(object, key)) {
        throw new Error(`duplicate structured binary metadata key: ${key}`);
      }
      object[key] = readStructuredJsonValue(reader);
    }
    return object;
  }
  throw new Error(`unsupported structured binary metadata tag: ${tag}`);
}
