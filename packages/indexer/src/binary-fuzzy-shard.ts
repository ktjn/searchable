import type { FuzzyShard } from "@csf/format";
import { ByteWriter } from "./byte-writer.js";

/**
 * Directory-based binary fuzzy (SymSpell deletion-dictionary) shard
 * encoding, the same shape as `binary-term-shard.ts` applied to a
 * different dictionary: a fuzzy shard can be as large as the term
 * vocabulary itself (docs/guides/ranking-and-boosts.md#prefix-and-fuzzy-matching,
 * "roughly proportional to total term length across the vocabulary",
 * doubling or more for `fuzzyMaxEdits: 2`), but a query only ever looks
 * up a handful of specific deletion-variant keys
 * (`packages/client/src/search.ts`'s `fuzzyCandidatesFor()`) -- the same
 * "large dictionary, few keys touched per query" shape the term-shard
 * binary tier was built and benchmarked for
 * (docs/archive/investigations/binary-vs-json-index.md), so the same
 * directory + lazy-per-key-decode technique applies directly without
 * needing its own from-scratch benchmark.
 *
 * Layout: `[maxEdits][directory][deletions blob]`. `varint(maxEdits)`,
 * then the directory: `varint(variantCount)`, then per deletion-variant
 * (sorted): `string(variant)`, `varint(byteOffsetIntoBlob)`,
 * `varint(byteLength)`. Each variant's blob is: `varint(termCount)`,
 * then `string(term)` per real term that produced this variant.
 */
export function encodeFuzzyShardBinary(shard: FuzzyShard): Uint8Array {
  const variants = Object.keys(shard.deletions).sort();
  const blobs = variants.map((variant) => {
    const terms = shard.deletions[variant] ?? [];
    const w = new ByteWriter();
    w.writeVarint(terms.length);
    for (const term of terms) w.writeString(term);
    return w.toUint8Array();
  });

  const header = new ByteWriter();
  header.writeVarint(shard.maxEdits);
  header.writeVarint(variants.length);
  let offset = 0;
  for (const [i, variant] of variants.entries()) {
    const blob = blobs[i];
    if (!blob)
      throw new Error(`missing deletions blob for variant "${variant}"`);
    header.writeString(variant);
    header.writeVarint(offset);
    header.writeVarint(blob.length);
    offset += blob.length;
  }
  const headerBytes = header.toUint8Array();

  const blobWriter = new ByteWriter();
  for (const blob of blobs) blobWriter.writeBytes(blob);
  const blobBytes = blobWriter.toUint8Array();

  const out = new Uint8Array(headerBytes.length + blobBytes.length);
  out.set(headerBytes, 0);
  out.set(blobBytes, headerBytes.length);
  return out;
}
