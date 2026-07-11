import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SourceDocument } from "@csf/indexer";
import { buildIndex, writeIndex } from "@csf/indexer";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { SearchClient } from "../src/client.js";
import { serveStatic } from "./static-server.js";

/**
 * Issue #1 finding 6 (productization review): the doc store used to
 * always be exactly one physical shard covering the whole corpus
 * (`docs/0.json`), so a query paid to fetch the entire store regardless
 * of how few hits it actually returned. `writeIndex({docStoreShardSize})`
 * now splits it into multiple contiguous-id-range shards, and the
 * client's existing `fetchDocStoreEntriesByIds()` (already written to
 * handle any number of shards) fetches only the ones that actually cover
 * a query's hit ids. This proves both halves together, over real HTTP:
 * correctness (a query whose hits straddle a shard boundary still
 * returns exactly right) and the actual point (a query touching one
 * shard's range never fetches the others).
 */
const DOC_COUNT = 25;
const SHARD_SIZE = 10; // -> shards covering ids [1-10], [11-20], [21-25]

function makeSources(): SourceDocument[] {
  const sources: SourceDocument[] = [];
  for (let id = 1; id <= DOC_COUNT; id++) {
    sources.push({
      id,
      url: `/doc-${id}`,
      html: `<html lang="en"><head><title>Doc ${id}</title></head>
        <body><main><p>widget uniqueterm${id}</p></main></body></html>`,
    });
  }
  return sources;
}

describe("doc store sharding by idRange (real HTTP)", () => {
  let shardedBaseUrl: string;
  let closeShardedServer: () => Promise<void>;
  let shardedOutDir: string;

  let unshardedBaseUrl: string;
  let closeUnshardedServer: () => Promise<void>;
  let unshardedOutDir: string;

  beforeAll(async () => {
    const sources = makeSources();

    shardedOutDir = await mkdtemp(join(tmpdir(), "csf-docstore-sharded-"));
    await writeIndex(buildIndex(sources, "en"), shardedOutDir, {
      docStoreShardSize: SHARD_SIZE,
    });
    const shardedServer = await serveStatic(shardedOutDir);
    shardedBaseUrl = shardedServer.baseUrl;
    closeShardedServer = shardedServer.close;

    unshardedOutDir = await mkdtemp(join(tmpdir(), "csf-docstore-unsharded-"));
    await writeIndex(buildIndex(sources, "en"), unshardedOutDir);
    const unshardedServer = await serveStatic(unshardedOutDir);
    unshardedBaseUrl = unshardedServer.baseUrl;
    closeUnshardedServer = unshardedServer.close;
  });

  afterAll(async () => {
    await Promise.all([closeShardedServer(), closeUnshardedServer()]);
    await Promise.all([
      rm(shardedOutDir, { recursive: true, force: true }),
      rm(unshardedOutDir, { recursive: true, force: true }),
    ]);
  });

  it("splits the manifest into 3 doc-store shards with the expected idRanges", async () => {
    const manifest = await fetch(`${shardedBaseUrl}manifest.json`).then((r) =>
      r.json(),
    );
    expect(manifest.shards.docs).toHaveLength(3);
    const idRanges = manifest.shards.docs
      .map((d: { idRange: [number, number] }) => d.idRange)
      .sort((a: [number, number], b: [number, number]) => a[0] - b[0]);
    expect(idRanges).toEqual([
      [1, 10],
      [11, 20],
      [21, 25],
    ]);
  });

  it("a query whose hits straddle a shard boundary returns identical results, sharded vs. unsharded", async () => {
    const sharded = new SearchClient({
      indexUrl: `${shardedBaseUrl}manifest.json`,
    });
    const unsharded = new SearchClient({
      indexUrl: `${unshardedBaseUrl}manifest.json`,
    });
    // "widget" matches every doc (ids 1-25), spanning all 3 shards.
    const [shardedResult, unshardedResult] = await Promise.all([
      sharded.search("widget", { limit: DOC_COUNT }),
      unsharded.search("widget", { limit: DOC_COUNT }),
    ]);
    expect(shardedResult.hits.map((h) => h.id).sort((a, b) => a - b)).toEqual(
      unshardedResult.hits.map((h) => h.id).sort((a, b) => a - b),
    );
    expect(shardedResult.totalHits).toBe(DOC_COUNT);
    expect(shardedResult.hits.find((h) => h.id === 10)?.url).toBe("/doc-10");
    expect(shardedResult.hits.find((h) => h.id === 11)?.url).toBe("/doc-11");
  });

  it("a query for a single doc's unique term returns exactly that doc regardless of which shard it's in", async () => {
    const client = new SearchClient({
      indexUrl: `${shardedBaseUrl}manifest.json`,
    });
    for (const id of [3, 15, 23]) {
      // shard 0, 1, 2 respectively
      const result = await client.search(`uniqueterm${id}`);
      expect(result.hits.map((h) => h.id)).toEqual([id]);
      expect(result.hits[0]?.url).toBe(`/doc-${id}`);
    }
  });

  describe("fetches only the doc-store shard(s) that cover a query's hit ids", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      vi.spyOn(globalThis, "fetch");
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("does not fetch every doc-store shard file for a query hitting only one shard's range", async () => {
      const client = new SearchClient({
        indexUrl: `${shardedBaseUrl}manifest.json`,
      });
      await client.search("uniqueterm3"); // only in shard 0 (ids 1-10)

      const fetchedUrls = vi
        .mocked(globalThis.fetch)
        .mock.calls.map((call) => String(call[0]));
      const docShardFetches = fetchedUrls.filter((url) => /\/docs\//.test(url));
      expect(docShardFetches).toHaveLength(1);
    });

    it("fetches all 3 doc-store shards for a query whose hits span every shard", async () => {
      const client = new SearchClient({
        indexUrl: `${shardedBaseUrl}manifest.json`,
      });
      await client.search("widget", { limit: DOC_COUNT });

      const fetchedUrls = vi
        .mocked(globalThis.fetch)
        .mock.calls.map((call) => String(call[0]));
      const docShardFetches = new Set(
        fetchedUrls.filter((url) => /\/docs\//.test(url)),
      );
      expect(docShardFetches.size).toBe(3);
    });
  });
});
