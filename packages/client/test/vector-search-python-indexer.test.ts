import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SearchClient } from "../src/client.js";
import type { PythonSourceDocument as SourceDocument } from "../test-support/python-index.js";
import { writePythonIndex } from "../test-support/python-index.js";
import { serveStatic } from "./static-server.js";

/**
 * Proves the real Python `searchable-indexer` can build a vector shard
 * end-to-end -- previously vector shards only existed via the TS-only
 * `writeVectorFixture` test helper (see vector-hybrid-search.test.ts),
 * since the Python indexer had no embedding/vector support at all. This
 * loads a Python-built vector shard through the real `SearchClient` in
 * `mode: "vector"` and confirms it's usable, closing that gap.
 */
const sources: SourceDocument[] = [
  {
    id: 1,
    url: "/widgets",
    html: `<html lang="en"><head><title>Widgets</title></head>
      <body><main><p>Our widgets are wonderful and useful for everyone.</p></main></body></html>`,
  },
  {
    id: 2,
    url: "/gadgets",
    html: `<html lang="en"><head><title>Gadgets</title></head>
      <body><main><p>Gadgets and gizmos for every occasion.</p></main></body></html>`,
  },
];

describe("vector search against a real Python-built index", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const built = await writePythonIndex(sources, {
      defaultLanguage: "en",
      embed: "deterministic",
      embeddingProvider: { type: "custom" },
      vectorQuantization: "float32",
    });
    cleanup = built.cleanup;
    const server = await serveStatic(built.outDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  afterAll(async () => {
    await closeServer();
    await cleanup();
  });

  it("records a vectors block on the manifest with a shard per language", async () => {
    const manifest = await fetch(`${baseUrl}manifest.json`).then((r) =>
      r.json(),
    );
    expect(manifest.vectors.quantization).toBe("float32");
    expect(manifest.vectors.embeddingProvider).toEqual({ type: "custom" });
    expect(Object.keys(manifest.vectors.shards)).toEqual(["en"]);
  });

  it('mode: "vector" returns hits for both indexed documents', async () => {
    const client = new SearchClient({
      indexUrl: `${baseUrl}manifest.json`,
      embedQuery: (query) => [query.length, 0],
    });
    const result = await client.search("widgets", { mode: "vector" });
    expect(result.hits.map((h) => h.id).sort()).toEqual([1, 2]);
  });
});
