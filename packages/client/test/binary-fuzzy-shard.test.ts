import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndex, writeIndex } from "@csf/indexer";
import type { SourceDocument } from "@csf/indexer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SearchClient } from "../src/client.js";
import { serveStatic } from "./static-server.js";

/**
 * Real-HTTP JSON-vs-binary equivalence, same rigor as
 * binary-term-shard.test.ts: the same corpus + fuzzy dictionary built
 * both ways, queried through a real `SearchClient`, asserting identical
 * hit ids for a typo query and identical "did you mean" suggestions --
 * not just that both return non-empty results.
 */
const sources: SourceDocument[] = [
  {
    id: 1,
    url: "/widgets",
    html: `<html lang="en"><head><title>Amazing Widgets</title></head>
      <body><main><p>Our widgets are wonderful. Buy widgets today.</p></main></body></html>`,
  },
  {
    id: 2,
    url: "/gadgets",
    html: `<html lang="en"><head><title>Gadgets</title></head>
      <body><main><p>Gadgets and gizmos, plus a few widgets for good measure.</p></main></body></html>`,
  },
];

describe("binary fuzzy shards return identical results to JSON (real HTTP)", () => {
  let jsonBaseUrl: string;
  let closeJsonServer: () => Promise<void>;
  let jsonOutDir: string;

  let binaryBaseUrl: string;
  let closeBinaryServer: () => Promise<void>;
  let binaryOutDir: string;

  beforeAll(async () => {
    jsonOutDir = await mkdtemp(join(tmpdir(), "csf-binary-fuzzy-json-"));
    await writeIndex(buildIndex(sources, "en", { fuzzy: true }), jsonOutDir);
    const jsonServer = await serveStatic(jsonOutDir);
    jsonBaseUrl = jsonServer.baseUrl;
    closeJsonServer = jsonServer.close;

    binaryOutDir = await mkdtemp(join(tmpdir(), "csf-binary-fuzzy-bin-"));
    await writeIndex(buildIndex(sources, "en", { fuzzy: true }), binaryOutDir, {
      fuzzyShardFormat: "binary",
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

  it("records format: 'binary' on the binary manifest's fuzzy entry, absent on the JSON one", async () => {
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
    expect(jsonManifest.fuzzy.en.format).toBeUndefined();
    expect(binaryManifest.fuzzy.en.format).toBe("binary");
  });

  it("fuzzy-matched typo query: identical hit ids", async () => {
    const { json, binary } = clients();
    // "widgits" is a one-character-substitution typo of "widget" (the
    // stemmed form of "widgets").
    const [jsonResult, binaryResult] = await Promise.all([
      json.search("widgits", { fuzzy: true }),
      binary.search("widgits", { fuzzy: true }),
    ]);
    expect(binaryResult.hits.map((h) => h.id)).toEqual(
      jsonResult.hits.map((h) => h.id),
    );
    expect(jsonResult.hits.map((h) => h.id).sort()).toEqual([1, 2]);
  });

  it('"did you mean" suggestions: identical for a query that matches nothing', async () => {
    const { json, binary } = clients();
    // "gizoms" stems to "gizom", a transposition of "gizmo" (the
    // stemmed form of "gizmos") -- true Levenshtein distance 2, over
    // the distance-1 cap fuzzyMatchesFor enforces for this shard
    // (maxEdits: 1), so it organically fails to match anything, but is
    // still discoverable as a "did you mean" suggestion via the same
    // symmetric-delete lookup (nearestTermsFor doesn't apply that cap):
    // deleting "gizom"'s trailing "o" and "gizmo"'s trailing "o" both
    // land on the shared deletion-variant "gizm".
    const [jsonResult, binaryResult] = await Promise.all([
      json.search("gizoms", { fuzzy: true }),
      binary.search("gizoms", { fuzzy: true }),
    ]);
    expect(jsonResult.hits).toEqual([]);
    expect(binaryResult.didYouMean).toEqual(jsonResult.didYouMean);
    expect(jsonResult.didYouMean).toEqual(["gizmo"]);
  });

  it("no-match query: both return zero hits and no suggestions", async () => {
    const { json, binary } = clients();
    const [jsonResult, binaryResult] = await Promise.all([
      json.search("xyzzyquux", { fuzzy: true }),
      binary.search("xyzzyquux", { fuzzy: true }),
    ]);
    expect(jsonResult.hits).toEqual([]);
    expect(binaryResult.hits).toEqual([]);
  });
});
