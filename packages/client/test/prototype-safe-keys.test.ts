import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SourceDocument } from "@ktjn/searchable-indexer";
import { buildIndex, writeIndex } from "@ktjn/searchable-indexer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SearchClient } from "../src/client.js";
import { serveStatic } from "./static-server.js";

/**
 * "constructor" survives this project's lowercasing analysis unchanged
 * (unlike "toString"/"hasOwnProperty", which fold to "tostring"/
 * "hasownproperty" and so no longer collide) -- an ordinary English
 * word that's also the one `Object.prototype` member name a real query
 * can plausibly type. Query-time dictionary lookups keyed by the
 * literal query term (synonym directional expansion, fuzzy deletion
 * variants) must not be fooled by the prototype chain into treating a
 * missing key as present -- see `packages/analysis/src/safe-dict.ts`
 * (shared by `@ktjn/searchable-indexer` and `@ktjn/searchable-client` so the write-time and
 * read-time halves of this fix can't drift apart) and
 * `docs/reference/compatibility.md` for the full bug class this guards against.
 */
const sources: SourceDocument[] = [
  {
    id: 1,
    url: "/constructor",
    html: `<html lang="en"><head><title>Constructor</title></head>
      <body><main><p>A constructor is a special method used to initialize an object.</p></main></body></html>`,
  },
  {
    id: 2,
    url: "/widgets",
    html: `<html lang="en"><head><title>Widgets</title></head>
      <body><main><p>Our widgets are wonderful.</p></main></body></html>`,
  },
];

describe("query-time prototype-collision safety (real HTTP)", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let outDir: string;

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "searchable-proto-safe-"));
    // A directional synonym entry that has nothing to do with
    // "constructor" -- `synonymShard.directional` ends up a real,
    // non-empty object with no own "constructor" key, exactly the
    // shape that used to trip the bug on a lookup for that term.
    const built = buildIndex(sources, "en", {
      fuzzy: true,
      synonyms: { en: { directional: { widget: ["gadget"] } } },
    });
    await writeIndex(built, outDir);
    const server = await serveStatic(outDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  afterAll(async () => {
    await closeServer();
    await rm(outDir, { recursive: true, force: true });
  });

  it("searching the literal word 'constructor' with synonyms+fuzzy enabled does not throw, and finds the real hit", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const result = await client.search("constructor", {
      synonyms: true,
      fuzzy: true,
    });
    expect(result.hits.map((h) => h.id)).toContain(1);
  });

  it("options.language: 'constructor' fails clearly (unsupported language), not with a confusing crash deep in synonym/fuzzy lookup", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    await expect(
      client.search("constructor", { language: "constructor" }),
    ).rejects.toThrow(/no LanguageProfile registered for "constructor"/);
  });
});
