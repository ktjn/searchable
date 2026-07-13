import type { TermEntry, TermShard } from "@csf/format";
import { ByteWriter } from "./byte-writer.js";

/**
 * Directory-based binary term shard encoding
 * (docs/archive/specs/binary-format.md#dictionary-encoding's "sorted string
 * table" baseline, docs/archive/specs/binary-format.md#posting-encoding's
 * delta+varint baseline): a sorted term -> (byte offset, byte length)
 * directory followed by a postings blob, each term's postings
 * independently encoded so the client can decode *only* the terms a
 * query actually matched by seeking directly to their byte range
 * (docs/archive/specs/binary-format.md#decoding-strategy's "decode only matching
 * posting lists") -- never the whole shard.
 *
 * The archived investigation measured a 2.9x-9.5x decode speedup at
 * 1k/10k docs for a directory plus a handful of matched terms; see
 * docs/archive/investigations/binary-vs-json-index.md for the full
 * results and shard-vocabulary-size caveat.
 *
 * Layout: `[directory][postings blob]`. The directory is:
 * `varint(termCount)`, then per term (sorted): `string(term)`,
 * `varint(byteOffsetIntoPostingsBlob)`, `varint(byteLength)`. Each
 * term's postings blob is: `varint(df)`, `varint(postingCount)`, then
 * per posting: `varint(docIdDelta)`, `varint(hasBoost ? 1 : 0)`,
 * `float64(boost)` if present, `varint(fieldCount)`, then per field
 * (sorted by name): `string(fieldName)`, `varint(tf)`, `varint(len)`,
 * `varint(positionCount)`, `varint(positionDelta)` per position.
 *
 * Boost is encoded as float64, not float32: a document boost like 1.8
 * (`csf-boost`, docs/guides/ranking-and-boosts.md) doesn't round-trip
 * exactly through float32 (1.8 -> f32 -> f64 comes back as
 * 1.7999999523162842) -- a real precision loss the JSON tier's plain
 * decimal text never has.
 */

function encodePostings(entry: TermEntry): Uint8Array {
  const w = new ByteWriter();
  w.writeVarint(entry.df);
  w.writeVarint(entry.postings.length);
  let prevDoc = 0;
  for (const posting of entry.postings) {
    w.writeVarint(posting.doc - prevDoc);
    prevDoc = posting.doc;
    const hasBoost = typeof posting.boost === "number";
    w.writeVarint(hasBoost ? 1 : 0);
    if (hasBoost && posting.boost !== undefined) w.writeFloat64(posting.boost);
    const fieldNames = Object.keys(posting.fields).sort();
    w.writeVarint(fieldNames.length);
    for (const fieldName of fieldNames) {
      const field = posting.fields[fieldName];
      if (!field) continue;
      w.writeString(fieldName);
      w.writeVarint(field.tf);
      w.writeVarint(field.len);
      w.writeVarint(field.pos.length);
      let prevPos = 0;
      for (const pos of field.pos) {
        w.writeVarint(pos - prevPos);
        prevPos = pos;
      }
    }
  }
  return w.toUint8Array();
}

/** Encodes a full term shard into the directory-based binary layout described above. */
export function encodeTermShardBinary(termShard: TermShard): Uint8Array {
  const terms = Object.keys(termShard).sort();
  const postingsBlobs = terms.map((term) => {
    const entry = termShard[term];
    if (!entry) throw new Error(`missing term entry for "${term}"`);
    return encodePostings(entry);
  });

  const dir = new ByteWriter();
  dir.writeVarint(terms.length);
  let offset = 0;
  for (const [i, term] of terms.entries()) {
    const blob = postingsBlobs[i];
    if (!blob) throw new Error(`missing postings blob for term "${term}"`);
    dir.writeString(term);
    dir.writeVarint(offset);
    dir.writeVarint(blob.length);
    offset += blob.length;
  }
  const directoryBytes = dir.toUint8Array();

  const postingsBlob = new ByteWriter();
  for (const blob of postingsBlobs) postingsBlob.writeBytes(blob);
  const postingsBytes = postingsBlob.toUint8Array();

  const out = new Uint8Array(directoryBytes.length + postingsBytes.length);
  out.set(directoryBytes, 0);
  out.set(postingsBytes, directoryBytes.length);
  return out;
}
