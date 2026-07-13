import type { DocStoreShard } from "@ktjn/searchable-format";
import { ByteWriter } from "./byte-writer.js";

/**
 * Directory-based binary doc store shard encoding. Motivated
 * differently than the term/fuzzy shards' "large dictionary, few keys
 * touched" shape: there is (today) exactly one doc store shard for the
 * *whole* corpus regardless of size (`write-index.ts` always emits one
 * `docs/0.json`), so every query that needs even a single hit's
 * stored fields currently fetches and JSON-parses every document in the
 * corpus — this format lets it decode only the specific hit ids a query
 * actually needs, by seeking directly to each one's byte range.
 *
 * Layout: `[directory][records blob]`. The directory is:
 * `varint(docCount)`, then per document (sorted ascending by numeric
 * id): `varint(docIdDelta)`, `varint(byteOffsetIntoBlob)`,
 * `varint(byteLength)`. Each document's record is: `string(url)`,
 * `varint(hasBoost ? 1 : 0)`, `float64(boost)` if present,
 * `varint(fieldCount)`, then per field (sorted by name):
 * `string(fieldName)`, `string(fieldValue)`.
 */
export function encodeDocStoreBinary(shard: DocStoreShard): Uint8Array {
  const ids = Object.keys(shard)
    .map(Number)
    .sort((a, b) => a - b);

  const blobs = ids.map((id) => {
    const entry = shard[String(id)];
    if (!entry) throw new Error(`missing doc store entry for id ${id}`);
    const w = new ByteWriter();
    w.writeString(entry.url);
    const hasBoost = typeof entry.boost === "number";
    w.writeVarint(hasBoost ? 1 : 0);
    if (hasBoost && entry.boost !== undefined) w.writeFloat64(entry.boost);
    const fieldNames = Object.keys(entry.fields).sort();
    w.writeVarint(fieldNames.length);
    for (const fieldName of fieldNames) {
      w.writeString(fieldName);
      w.writeString(entry.fields[fieldName] ?? "");
    }
    return w.toUint8Array();
  });

  const dir = new ByteWriter();
  dir.writeVarint(ids.length);
  let prevId = 0;
  let offset = 0;
  for (const [i, id] of ids.entries()) {
    const blob = blobs[i];
    if (!blob) throw new Error(`missing record blob for doc id ${id}`);
    dir.writeVarint(id - prevId);
    prevId = id;
    dir.writeVarint(offset);
    dir.writeVarint(blob.length);
    offset += blob.length;
  }
  const dirBytes = dir.toUint8Array();

  const blobWriter = new ByteWriter();
  for (const blob of blobs) blobWriter.writeBytes(blob);
  const blobBytes = blobWriter.toUint8Array();

  const out = new Uint8Array(dirBytes.length + blobBytes.length);
  out.set(dirBytes, 0);
  out.set(blobBytes, dirBytes.length);
  return out;
}
