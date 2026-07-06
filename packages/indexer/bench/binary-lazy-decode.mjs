#!/usr/bin/env node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { generateCms2kCorpus } from "@csf/fixtures";
import { buildIndex, writeIndex } from "../dist/index.js";

/**
 * Follow-up to binary-vs-json-postings.mjs, answering the question that
 * benchmark's own writeup left open (see docs/11-binary-vs-json-index.md's
 * "Revised recommendation"): does *lazy per-term* posting decode -- only
 * decoding the postings for terms a query actually matched, not the
 * whole shard -- flip the earlier finding that whole-shard binary
 * decode is slower than native `JSON.parse`?
 *
 * Encodes the same largest-single-prefix-shard baseline into a
 * directory-based binary layout: a header listing every term with its
 * byte offset/length into a following postings blob (each term's
 * postings independently encoded with the same delta+varint scheme as
 * binary-vs-json-postings.mjs), so a specific term's postings can be
 * decoded by seeking directly to its byte range -- without touching any
 * other term's bytes at all, let alone decoding them. This is
 * `spec-binary-format.md#dictionary-encoding`'s "sorted string table"
 * baseline recommendation, and `#decoding-strategy`'s "decode only
 * matching posting lists" guidance, neither of which
 * binary-vs-json-postings.mjs's whole-shard encoding attempted.
 *
 * Every term's lazy-decoded result is round-trip-verified against the
 * full JSON.parse'd shard before any number is reported, so a favorable
 * (or unfavorable) result is never a decoder bug in disguise.
 */

const SIZES = process.env.CSF_BENCH_SIZES
  ? process.env.CSF_BENCH_SIZES.split(",").map(Number)
  : [1000, 10000, 100000];

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// --- minimal unsigned LEB128 varint read/write over a growable buffer
// (identical scheme to binary-vs-json-postings.mjs; duplicated rather
// than imported since both are standalone, non-shipped investigation
// scripts, not a shared library the real indexer depends on) ---

class ByteWriter {
  #chunks = [];
  #buf = new Uint8Array(4096);
  #len = 0;

  #ensure(extra) {
    if (this.#len + extra <= this.#buf.length) return;
    this.#chunks.push(this.#buf.subarray(0, this.#len));
    this.#buf = new Uint8Array(Math.max(4096, extra * 2));
    this.#len = 0;
  }

  writeVarint(value) {
    this.#ensure(10);
    let v = value;
    while (v >= 0x80) {
      this.#buf[this.#len++] = (v & 0x7f) | 0x80;
      v = Math.floor(v / 128);
    }
    this.#buf[this.#len++] = v;
  }

  writeBytes(bytes) {
    this.#ensure(bytes.length);
    this.#buf.set(bytes, this.#len);
    this.#len += bytes.length;
  }

  writeString(str) {
    const bytes = Buffer.from(str, "utf8");
    this.writeVarint(bytes.length);
    this.writeBytes(bytes);
  }

  writeFloat64(value) {
    this.#ensure(8);
    new DataView(
      this.#buf.buffer,
      this.#buf.byteOffset + this.#len,
      8,
    ).setFloat64(0, value, true);
    this.#len += 8;
  }

  toUint8Array() {
    this.#chunks.push(this.#buf.subarray(0, this.#len));
    const total = this.#chunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.#chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    this.#chunks = [out];
    this.#buf = new Uint8Array(0);
    this.#len = 0;
    return out;
  }
}

class ByteReader {
  #view;
  #pos;
  constructor(bytes, startPos = 0) {
    this.#view = bytes;
    this.#pos = startPos;
  }

  get position() {
    return this.#pos;
  }

  readVarint() {
    let result = 0;
    let shift = 1;
    for (;;) {
      const byte = this.#view[this.#pos++];
      result += (byte & 0x7f) * shift;
      if ((byte & 0x80) === 0) return result;
      shift *= 128;
    }
  }

  readBytes(length) {
    const out = this.#view.subarray(this.#pos, this.#pos + length);
    this.#pos += length;
    return out;
  }

  readString() {
    const length = this.readVarint();
    return Buffer.from(this.readBytes(length)).toString("utf8");
  }

  readFloat64() {
    const value = new DataView(
      this.#view.buffer,
      this.#view.byteOffset + this.#pos,
      8,
    ).getFloat64(0, true);
    this.#pos += 8;
    return value;
  }
}

/** Encodes one term's df + postings (not the surrounding term name/offset bookkeeping -- that lives in the directory). */
function encodePostings(entry) {
  const w = new ByteWriter();
  w.writeVarint(entry.df);
  w.writeVarint(entry.postings.length);
  let prevDoc = 0;
  for (const posting of entry.postings) {
    w.writeVarint(posting.doc - prevDoc);
    prevDoc = posting.doc;
    const hasBoost = typeof posting.boost === "number";
    w.writeVarint(hasBoost ? 1 : 0);
    if (hasBoost) w.writeFloat64(posting.boost);
    const fieldNames = Object.keys(posting.fields).sort();
    w.writeVarint(fieldNames.length);
    for (const fieldName of fieldNames) {
      const field = posting.fields[fieldName];
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

function decodePostings(bytes, startPos) {
  const r = new ByteReader(bytes, startPos);
  const df = r.readVarint();
  const postingCount = r.readVarint();
  const postings = [];
  let prevDoc = 0;
  for (let j = 0; j < postingCount; j++) {
    prevDoc += r.readVarint();
    const doc = prevDoc;
    const hasBoost = r.readVarint() === 1;
    const boost = hasBoost ? r.readFloat64() : undefined;
    const fieldCount = r.readVarint();
    const fields = {};
    for (let k = 0; k < fieldCount; k++) {
      const fieldName = r.readString();
      const tf = r.readVarint();
      const len = r.readVarint();
      const posCount = r.readVarint();
      const pos = [];
      let prevPos = 0;
      for (let p = 0; p < posCount; p++) {
        prevPos += r.readVarint();
        pos.push(prevPos);
      }
      fields[fieldName] = { tf, pos, len };
    }
    postings.push(hasBoost ? { doc, boost, fields } : { doc, fields });
  }
  return { df, postings };
}

/**
 * Directory-based layout: [directory][postings blob]. The directory is
 * a sorted term -> (offset, length) table, decodable on its own without
 * touching a single posting byte -- spec-binary-format.md's "sorted
 * string table + binary search" baseline recommendation.
 */
function encodeShardWithDirectory(termShard) {
  const terms = Object.keys(termShard).sort();
  const postingsBlobs = terms.map((term) => encodePostings(termShard[term]));

  const dir = new ByteWriter();
  dir.writeVarint(terms.length);
  let offset = 0;
  for (const [i, term] of terms.entries()) {
    dir.writeString(term);
    dir.writeVarint(offset);
    dir.writeVarint(postingsBlobs[i].length);
    offset += postingsBlobs[i].length;
  }
  const directoryBytes = dir.toUint8Array();

  const postingsBlob = new ByteWriter();
  for (const blob of postingsBlobs) postingsBlob.writeBytes(blob);
  const postingsBytes = postingsBlob.toUint8Array();

  const out = new Uint8Array(directoryBytes.length + postingsBytes.length);
  out.set(directoryBytes, 0);
  out.set(postingsBytes, directoryBytes.length);
  return { bytes: out, directoryLength: directoryBytes.length };
}

/** Decodes just the directory: term -> {offset, length} (relative to the postings blob start), no posting bytes touched. */
function decodeDirectory(bytes) {
  const r = new ByteReader(bytes, 0);
  const termCount = r.readVarint();
  const index = new Map();
  for (let i = 0; i < termCount; i++) {
    const term = r.readString();
    const offset = r.readVarint();
    const length = r.readVarint();
    index.set(term, { offset, length });
  }
  return { index, directoryByteLength: r.position };
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object") {
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(
      (key, i) => key === bKeys[i] && deepEqual(a[key], b[key]),
    );
  }
  return false;
}

async function largestTermShard(outDir, lang) {
  const manifest = JSON.parse(
    await readFile(join(outDir, "manifest.json"), "utf8"),
  );
  const entries = manifest.shards.terms.filter((s) => s.lang === lang);
  let largest;
  let largestGzip = -1;
  for (const entry of entries) {
    const raw = await readFile(join(outDir, entry.file), "utf8");
    const gzipBytes = gzipSync(raw, { level: 9 }).length;
    if (gzipBytes > largestGzip) {
      largestGzip = gzipBytes;
      largest = { entry, raw };
    }
  }
  return largest;
}

/** The N terms with the largest df in the shard -- the most expensive, least favorable-to-binary case for a query to touch, not a cherry-picked cheap one. */
function busiestTerms(termShard, n) {
  return Object.entries(termShard)
    .sort((a, b) => b[1].df - a[1].df)
    .slice(0, n)
    .map(([term]) => term);
}

async function benchOne(count) {
  const sources = generateCms2kCorpus({ count });
  const built = buildIndex(sources);
  const outDir = await mkdtemp(join(tmpdir(), "csf-bench-lazy-"));
  await writeIndex(built, outDir);

  const { entry, raw } = await largestTermShard(outDir, "en");
  await rm(outDir, { recursive: true, force: true });

  const termShard = JSON.parse(raw);

  const jsonParseStart = performance.now();
  JSON.parse(raw);
  const jsonParseMs = performance.now() - jsonParseStart;

  const { bytes, directoryLength } = encodeShardWithDirectory(termShard);

  const dirDecodeStart = performance.now();
  const { index } = decodeDirectory(bytes);
  const directoryDecodeMs = performance.now() - dirDecodeStart;

  // Correctness: every term, decoded individually via its directory
  // entry, must match the JSON-parsed shard -- not just the sampled
  // "typical query" terms measured below.
  for (const [term, { offset, length }] of index) {
    const decoded = decodePostings(bytes, directoryLength + offset);
    if (!deepEqual(decoded, termShard[term]) || length <= 0) {
      throw new Error(
        `lazy-decode round-trip mismatch for term "${term}" in prefix "${entry.prefix}" at ${count} docs -- encoder/decoder bug, not a real result`,
      );
    }
  }

  // "Typical query" simulation: the single busiest term (a one-word
  // query), and the three busiest terms (a three-word query) -- the
  // most expensive plausible case, not a cherry-picked cheap one.
  const oneTerm = busiestTerms(termShard, 1);
  const threeTerms = busiestTerms(termShard, Math.min(3, index.size));

  function decodeTerms(terms) {
    const start = performance.now();
    for (const term of terms) {
      const { offset } = index.get(term);
      decodePostings(bytes, directoryLength + offset);
    }
    return performance.now() - start;
  }

  const oneTermDecodeMs = decodeTerms(oneTerm);
  const threeTermDecodeMs = decodeTerms(threeTerms);

  return {
    count,
    prefix: entry.prefix,
    termCount: entry.termCount,
    jsonParseMs,
    directoryDecodeMs,
    oneTermTotalMs: directoryDecodeMs + oneTermDecodeMs,
    threeTermTotalMs: directoryDecodeMs + threeTermDecodeMs,
  };
}

async function main() {
  const results = [];
  for (const count of SIZES) {
    console.log(
      `\n=== ${count.toLocaleString()} documents (largest en term shard) ===`,
    );
    const r = await benchOne(count);
    results.push(r);
    console.log(`shard: prefix "${r.prefix}", ${r.termCount} terms`);
    console.log(
      `  JSON.parse (whole shard):        ${r.jsonParseMs.toFixed(2)} ms`,
    );
    console.log(
      `  binary directory decode alone:    ${r.directoryDecodeMs.toFixed(2)} ms`,
    );
    console.log(
      `  binary directory + 1 busiest term:  ${r.oneTermTotalMs.toFixed(2)} ms (${(r.jsonParseMs / r.oneTermTotalMs).toFixed(1)}x faster than JSON.parse)`,
    );
    console.log(
      `  binary directory + 3 busiest terms: ${r.threeTermTotalMs.toFixed(2)} ms (${(r.jsonParseMs / r.threeTermTotalMs).toFixed(1)}x faster than JSON.parse)`,
    );
    console.log(
      "  (every term's lazy decode round-trip-verified byte-identical to JSON)",
    );
  }

  console.log("\n=== Summary (largest single term shard, en) ===");
  console.log(
    "docs\tjsonParseMs\tdirDecodeMs\toneTermTotalMs\tspeedup1\tthreeTermTotalMs\tspeedup3",
  );
  for (const r of results) {
    console.log(
      `${r.count}\t${r.jsonParseMs.toFixed(2)}\t${r.directoryDecodeMs.toFixed(2)}\t${r.oneTermTotalMs.toFixed(2)}\t${(r.jsonParseMs / r.oneTermTotalMs).toFixed(1)}\t${r.threeTermTotalMs.toFixed(2)}\t${(r.jsonParseMs / r.threeTermTotalMs).toFixed(1)}`,
    );
  }

  console.log(
    "\nSee docs/11-binary-vs-json-index.md and docs/spec-binary-format.md for interpretation.",
  );

  console.log(
    `\n${JSON.stringify({ commit: process.env.GITHUB_SHA ?? "local", results }, null, 2)}`,
  );
}

main();
