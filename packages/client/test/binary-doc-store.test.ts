import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SourceDocument } from "@ktjn/searchable-indexer";
import { buildIndex, writeIndex } from "@ktjn/searchable-indexer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SearchClient } from "../src/client.js";
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
const sources: SourceDocument[] = [
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

describe("binary doc store returns identical results to JSON (real HTTP)", () => {
  let jsonBaseUrl: string;
  let closeJsonServer: () => Promise<void>;
  let jsonOutDir: string;

  let binaryBaseUrl: string;
  let closeBinaryServer: () => Promise<void>;
  let binaryOutDir: string;

  beforeAll(async () => {
    jsonOutDir = await mkdtemp(join(tmpdir(), "csf-binary-docstore-json-"));
    await writeIndex(buildIndex(sources, "en"), jsonOutDir);
    const jsonServer = await serveStatic(jsonOutDir);
    jsonBaseUrl = jsonServer.baseUrl;
    closeJsonServer = jsonServer.close;

    binaryOutDir = await mkdtemp(join(tmpdir(), "csf-binary-docstore-bin-"));
    await writeIndex(buildIndex(sources, "en"), binaryOutDir, {
      docStoreFormat: "binary",
    });
    const binaryServer = await serveStatic(binaryOutDir);
    binaryBaseUrl = binaryServer.baseUrl;
    closeBinaryServer = binaryServer.close;
  });

  afterAll(async () => {
    await Promise.all([closeJsonServer(), closeBinaryServer()]);
    await Promise.all([
      rm(jsonOutDir, { recursive: true, force: true }),
      rm(binaryOutDir, { recursive: true, force: true }),
    ]);
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
