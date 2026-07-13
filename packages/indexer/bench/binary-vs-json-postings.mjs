#!/usr/bin/env node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { generateCms2kCorpus } from "@csf/fixtures";
import { buildIndex, writeIndex } from "../dist/index.js";

/**
 * Binary-vs-JSON *postings encoding* benchmark for the Phase 7
 * investigation (docs/concepts/binary-storage.md, docs/archive/roadmaps/implementation-history.md#phase-7--scale-options,
 * docs/archive/specs/binary-format.md): takes the single largest real term shard
 * a query could actually have to fetch (per the now-fixed prefix
 * sharding, packages/indexer/bench/json-tier-scaling.mjs), encodes its
 * postings with a minimal delta+varint binary scheme matching
 * archive/specs/binary-format.md's own baseline recommendation (delta-encoded
 * doc ids, varints throughout, delta-encoded positions), and measures
 * the real bytes-on-the-wire (gzip) and decode-time difference against
 * the same shard's existing JSON representation.
 *
 * This is deliberately investigation-only code: the encoder/decoder
 * here are NOT part of @csf/format or @csf/indexer's shipped API. Per
 * archive/specs/binary-format.md's own "Success Criteria" ("Binary should only
 * become the default when benchmarks prove it"), the point of this
 * script is to produce that proof (or disproof) with real numbers
 * before writing a single line of production binary-tier code -- not
 * to prototype the shipped feature itself.
 *
 * Round-trips every encoded shard back through the decoder and asserts
 * deep equality against the original JSON-parsed shard, so a size/speed
 * number is never reported for an encoding that doesn't actually
 * preserve the data.
 */

const SIZES = process.env.CSF_BENCH_SIZES
  ? process.env.CSF_BENCH_SIZES.split(",").map(Number)
  : [1000, 10000, 100000];

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// --- minimal unsigned LEB128 varint read/write over a growable buffer ---

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

  // Float64, not Float32: a document boost like 1.8 (@csf/fixtures's
  // "featured" documents, see generate.ts) doesn't round-trip exactly
  // through float32 -- 1.8 -> f32 -> f64 comes back as
  // 1.7999999523162842, a real precision loss the JSON tier (plain
  // decimal text) never has. Correctness has to come before the extra
  // 4 bytes/posting this costs.
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
  #pos = 0;
  constructor(bytes) {
    this.#view = bytes;
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

/**
 * Baseline posting encoding per docs/archive/specs/binary-format.md#posting-encoding:
 * doc ids delta-encoded ascending, varints throughout, positions
 * delta-encoded per field. Terms are written in the shard's own
 * (canonical, sorted) key order for determinism, matching
 * write-index.ts's `canonicalize()`.
 */
function encodeTermShard(termShard) {
  const w = new ByteWriter();
  const terms = Object.keys(termShard).sort();
  w.writeVarint(terms.length);
  for (const term of terms) {
    const entry = termShard[term];
    w.writeString(term);
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
  }
  return w.toUint8Array();
}

function decodeTermShard(bytes) {
  const r = new ByteReader(bytes);
  const termCount = r.readVarint();
  const termShard = {};
  for (let i = 0; i < termCount; i++) {
    const term = r.readString();
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
    termShard[term] = { df, postings };
  }
  return termShard;
}

/**
 * Order-independent structural equality -- object key insertion order
 * legitimately differs between the encoder's own construction order and
 * the canonical (sorted-key) JSON on disk, so a plain
 * `JSON.stringify(a) === JSON.stringify(b)` would report false
 * mismatches on semantically identical data.
 */
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

async function benchOne(count) {
  const sources = generateCms2kCorpus({ count });
  const built = buildIndex(sources);
  const outDir = await mkdtemp(join(tmpdir(), "csf-bench-binary-"));
  await writeIndex(built, outDir);

  const { entry, raw } = await largestTermShard(outDir, "en");
  await rm(outDir, { recursive: true, force: true });

  const termShard = JSON.parse(raw);

  const jsonRawBytes = Buffer.byteLength(raw, "utf8");
  const jsonGzipBytes = gzipSync(raw, { level: 9 }).length;
  const jsonParseStart = performance.now();
  JSON.parse(raw);
  const jsonParseMs = performance.now() - jsonParseStart;

  const encodeStart = performance.now();
  const binary = encodeTermShard(termShard);
  const encodeMs = performance.now() - encodeStart;
  const binaryRawBytes = binary.length;
  const binaryGzipBytes = gzipSync(binary, { level: 9 }).length;

  const decodeStart = performance.now();
  const decoded = decodeTermShard(binary);
  const decodeMs = performance.now() - decodeStart;

  if (!deepEqual(decoded, termShard)) {
    throw new Error(
      `binary round-trip mismatch for prefix "${entry.prefix}" at ${count} docs -- encoder/decoder bug, not a real result`,
    );
  }

  return {
    count,
    prefix: entry.prefix,
    termCount: entry.termCount,
    jsonRawBytes,
    jsonGzipBytes,
    jsonParseMs,
    binaryRawBytes,
    binaryGzipBytes,
    encodeMs,
    decodeMs,
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
      `  JSON:   ${formatBytes(r.jsonRawBytes)} raw, ${formatBytes(r.jsonGzipBytes)} gzip, parse ${r.jsonParseMs.toFixed(1)} ms`,
    );
    console.log(
      `  binary: ${formatBytes(r.binaryRawBytes)} raw, ${formatBytes(r.binaryGzipBytes)} gzip, encode ${r.encodeMs.toFixed(1)} ms, decode ${r.decodeMs.toFixed(1)} ms`,
    );
    const gzipRatio = r.jsonGzipBytes / r.binaryGzipBytes;
    const parseRatio = r.jsonParseMs / r.decodeMs;
    console.log(
      `  binary is ${gzipRatio.toFixed(2)}x smaller (gzip), ${parseRatio.toFixed(2)}x faster to decode (round-trip verified byte-identical to JSON)`,
    );
  }

  console.log("\n=== Summary (largest single term shard, en) ===");
  console.log(
    "docs\tjsonGzipBytes\tbinaryGzipBytes\tgzipRatio\tjsonParseMs\tdecodeMs\tspeedRatio",
  );
  for (const r of results) {
    console.log(
      `${r.count}\t${r.jsonGzipBytes}\t${r.binaryGzipBytes}\t${(r.jsonGzipBytes / r.binaryGzipBytes).toFixed(2)}\t${r.jsonParseMs.toFixed(1)}\t${r.decodeMs.toFixed(1)}\t${(r.jsonParseMs / r.decodeMs).toFixed(2)}`,
    );
  }

  console.log(
    "\nSee docs/concepts/binary-storage.md and docs/archive/specs/binary-format.md for interpretation.",
  );

  console.log(
    `\n${JSON.stringify({ commit: process.env.GITHUB_SHA ?? "local", results }, null, 2)}`,
  );
}

main();
