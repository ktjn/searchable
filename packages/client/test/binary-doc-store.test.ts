import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  decodeBinaryDocStoreDirectory,
  decodeBinaryDocStoreEntry,
} from "../src/binary-doc-store.js";
import { SearchClient } from "../src/client.js";
import type { PythonSourceDocument } from "../test-support/python-index.js";
import { writePythonIndex } from "../test-support/python-index.js";
import { serveStatic } from "./static-server.js";

/**
 * Real-HTTP JSON-vs-binary equivalence for the doc store shard
 * (`packages/indexer/src/binary-doc-store.ts`, `packages/client/src/binary-doc-store.ts`),
 * same rigor as binary-term-shard.test.ts: the same corpus built both
 * ways, queried through a real `SearchClient`, asserting identical
 * `url`/stored `fields`/`score` (the last exercising the float64
 * `searchable-boost` round-trip) across a plain query, a multi-field-stored
 * hit, and a query whose hit count is a small fraction of the corpus
 * (the actual scenario the binary doc store's lazy per-id decode is
 * for) -- not just that both return non-empty results.
 */
const sources: PythonSourceDocument[] = [
  {
    id: 1,
    url: "/widgets",
    html: `<html lang="en"><head><title>Amazing Widgets</title>
      <meta name="searchable-boost" content="1.8">
      <meta name="description" content="Premium widgets for every need.">
      </head>
      <body><main><p>Our widgets are wonderful. Buy widgets today.</p></main></body></html>`,
  },
  {
    id: 2,
    url: "/gadgets",
    html: `<html lang="en"><head><title>Gadgets</title></head>
      <body><main><p>Gadgets and gizmos, plus a few widgets for good measure.</p></main></body></html>`,
  },
  {
    id: 3,
    url: "/sofa",
    html: `<html lang="en"><head><title>Sofa Selection</title></head>
      <body><main><p>Our sofa selection is huge.</p></main></body></html>`,
  },
];

function varint(value: number): Uint8Array {
  const out: number[] = [];
  let current = value;
  do {
    const byte = current & 0x7f;
    current >>>= 7;
    out.push(current ? byte | 0x80 : byte);
  } while (current);
  return new Uint8Array(out);
}

function string(value: string): Uint8Array {
  const encoded = new TextEncoder().encode(value);
  const result = new Uint8Array(varint(encoded.length).length + encoded.length);
  result.set(varint(encoded.length));
  result.set(encoded, varint(encoded.length).length);
  return result;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function float64(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, true);
  return bytes;
}

function taggedMetadata(): Uint8Array {
  return concat(
    varint(6),
    varint(2),
    string("chunkIndex"),
    varint(3),
    float64(2),
    string("headingPath"),
    varint(5),
    varint(2),
    varint(4),
    string("RAG"),
    varint(4),
    string("Answer"),
  );
}

it("decodes structured binary v2 document fields", () => {
  const record = concat(
    new TextEncoder().encode("SDOC"),
    varint(2),
    string("https://example.com/rag"),
    varint(15),
    float64(1.5),
    string("docs/rag.md#answer"),
    string("sha256:abc"),
    taggedMetadata(),
    varint(1),
    string("content"),
    string("Evidence"),
  );
  const data = concat(
    new TextEncoder().encode("SDOC"),
    varint(2),
    varint(1),
    varint(7),
    varint(0),
    varint(record.length),
    record,
  );

  const directory = decodeBinaryDocStoreDirectory(data);
  const entry = decodeBinaryDocStoreEntry(
    data,
    directory.directoryByteLength,
    directory.index.get(7)?.offset ?? -1,
    2,
  );

  expect(entry).toEqual({
    url: "https://example.com/rag",
    boost: 1.5,
    externalId: "docs/rag.md#answer",
    contentHash: "sha256:abc",
    metadata: { chunkIndex: 2, headingPath: ["RAG", "Answer"] },
    fields: { content: "Evidence" },
  });
});

it("rejects malformed structured binary v2 document stores", () => {
  expect(() => decodeBinaryDocStoreDirectory(new TextEncoder().encode("NOPE\u0002"), 2)).toThrow(
    /magic/,
  );
});

describe("binary doc store returns identical results to JSON (real HTTP)", () => {
  let jsonBaseUrl: string;
  let closeJsonServer: () => Promise<void>;
  let jsonBuilt: { outDir: string; cleanup: () => Promise<void> };

  let binaryBaseUrl: string;
  let closeBinaryServer: () => Promise<void>;
  let binaryBuilt: { outDir: string; cleanup: () => Promise<void> };

  beforeAll(async () => {
    jsonBuilt = await writePythonIndex(sources, { defaultLanguage: "en" });
    const jsonServer = await serveStatic(jsonBuilt.outDir);
    jsonBaseUrl = jsonServer.baseUrl;
    closeJsonServer = jsonServer.close;

    binaryBuilt = await writePythonIndex(
      sources,
      { defaultLanguage: "en" },
      { docStoreFormat: "binary" },
    );
    const binaryServer = await serveStatic(binaryBuilt.outDir);
    binaryBaseUrl = binaryServer.baseUrl;
    closeBinaryServer = binaryServer.close;
  });

  afterAll(async () => {
    await Promise.all([closeJsonServer(), closeBinaryServer()]);
    await Promise.all([jsonBuilt.cleanup(), binaryBuilt.cleanup()]);
  });

  function clients() {
    return {
      json: new SearchClient({ indexUrl: `${jsonBaseUrl}manifest.json` }),
      binary: new SearchClient({ indexUrl: `${binaryBaseUrl}manifest.json` }),
    };
  }

  it("records format: 'binary' on the binary manifest's docs shard entry, absent on the JSON one", async () => {
    const { json, binary } = clients();
    const [jsonManifest, binaryManifest] = await Promise.all([
      json
        .ready()
        .then(() => fetch(`${jsonBaseUrl}manifest.json`).then((r) => r.json())),
      binary
        .ready()
        .then(() =>
          fetch(`${binaryBaseUrl}manifest.json`).then((r) => r.json()),
        ),
    ]);
    expect(jsonManifest.shards.docs[0].format).toBeUndefined();
    expect(binaryManifest.shards.docs[0].format).toBe("binary");
  });

  it("identical url/fields/score for a query touching only a fraction of the corpus", async () => {
    const { json, binary } = clients();
    const [jsonResult, binaryResult] = await Promise.all([
      json.search("sofa"),
      binary.search("sofa"),
    ]);
    expect(binaryResult.hits).toEqual(jsonResult.hits);
    expect(jsonResult.hits.map((h) => h.id)).toEqual([3]);
    expect(jsonResult.hits[0]?.url).toBe("/sofa");
  });

  it("document boost (searchable-boost, a float64 round-trip) ranks identically and the score matches exactly", async () => {
    const { json, binary } = clients();
    const [jsonResult, binaryResult] = await Promise.all([
      json.search("widgets"),
      binary.search("widgets"),
    ]);
    expect(binaryResult.hits.map((h) => h.id)).toEqual(
      jsonResult.hits.map((h) => h.id),
    );
    expect(binaryResult.hits.map((h) => h.score)).toEqual(
      jsonResult.hits.map((h) => h.score),
    );
    // doc 1 has searchable-boost content="1.8" and should rank first identically.
    expect(jsonResult.hits[0]?.id).toBe(1);
  });

  it("multi-field stored fields (title + description-derived excerpt) round-trip identically", async () => {
    const { json, binary } = clients();
    const [jsonResult, binaryResult] = await Promise.all([
      json.search("widgets"),
      binary.search("widgets"),
    ]);
    const jsonDoc1 = jsonResult.hits.find((h) => h.id === 1);
    const binaryDoc1 = binaryResult.hits.find((h) => h.id === 1);
    expect(binaryDoc1?.fields).toEqual(jsonDoc1?.fields);
    expect(jsonDoc1?.fields.title).toBe("Amazing Widgets");
    expect(jsonDoc1?.fields.excerpt).toBe("Premium widgets for every need.");
  });

  it("no-match query: both return zero hits", async () => {
    const { json, binary } = clients();
    const [jsonResult, binaryResult] = await Promise.all([
      json.search("xyzzyquux"),
      binary.search("xyzzyquux"),
    ]);
    expect(jsonResult.hits).toEqual([]);
    expect(binaryResult.hits).toEqual([]);
  });
});
