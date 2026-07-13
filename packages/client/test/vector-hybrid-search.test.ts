import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SourceDocument } from "@ktjn/searchable-indexer";
import {
  buildIndex,
  buildVectorShards,
  writeIndex,
} from "@ktjn/searchable-indexer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SearchClient } from "../src/client.js";
import {
  VectorProviderMismatchError,
  VectorSearchNotConfiguredError,
} from "../src/vector-search.js";
import { serveStatic } from "./static-server.js";

/**
 * Vector/hybrid search mechanics (docs/guides/vector-search.md),
 * exercised end-to-end over real HTTP against an index built with a
 * deterministic, test-only "synthetic semantics" embedder: a small fixed
 * vocabulary is grouped into concept buckets, and a text's embedding is
 * just its per-bucket word counts. This isn't a real embedding model,
 * but it's a fully deterministic stand-in that genuinely demonstrates
 * the thing vector search is *for* -- finding a document that shares no
 * literal query terms at all, only the same underlying concepts -- so
 * the test can assert real before/after behavior (lexical search misses
 * it, vector/hybrid search finds it) instead of just "returns something
 * non-empty".
 */
const CONCEPT_BUCKETS: string[][] = [
  ["cancel", "cancelling", "closing", "close"],
  ["plan", "account", "subscription", "membership"],
  ["widgets", "gadgets"],
  ["support"],
];

function embedText(text: string): number[] {
  const words = text.toLowerCase().split(/\W+/).filter(Boolean);
  const vector = new Array(CONCEPT_BUCKETS.length).fill(0);
  for (const word of words) {
    for (let i = 0; i < CONCEPT_BUCKETS.length; i++) {
      if (CONCEPT_BUCKETS[i]?.includes(word)) vector[i]++;
    }
  }
  return vector;
}

function embedBatch(texts: string[]): number[][] {
  return texts.map(embedText);
}

const sources: SourceDocument[] = [
  {
    id: 1,
    url: "/cancel-plan",
    html: `<html lang="en"><head><title>Managing Your Plan</title></head>
      <body><main><p>Cancel your subscription plan anytime from account settings.</p></main></body></html>`,
  },
  {
    id: 2,
    url: "/closing-account",
    html: `<html lang="en"><head><title>Closing Your Account</title></head>
      <body><main><p>To close your membership visit the account page.</p></main></body></html>`,
  },
  {
    id: 3,
    url: "/widgets",
    html: `<html lang="en"><head><title>Amazing Widgets</title></head>
      <body><main><p>Buy our widgets and gadgets today, premium support included.</p></main></body></html>`,
  },
];

describe("vector/hybrid search mechanics (real HTTP, deterministic synthetic embedder)", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let outDir: string;

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "searchable-vector-hybrid-"));
    const built = buildIndex(sources, "en");
    const vectors = await buildVectorShards(sources, "en", {
      embed: embedBatch,
    });
    await writeIndex(built, outDir, { vectors });
    const server = await serveStatic(outDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  afterAll(async () => {
    await closeServer();
    await rm(outDir, { recursive: true, force: true });
  });

  function clientWithEmbed(): SearchClient {
    return new SearchClient({
      indexUrl: `${baseUrl}manifest.json`,
      embedQuery: (query) => embedText(query),
    });
  }

  it("records dims/quantization/embeddingProvider/shards on the manifest", async () => {
    const manifest = await fetch(`${baseUrl}manifest.json`).then((r) =>
      r.json(),
    );
    expect(manifest.vectors.dims).toBe(4);
    expect(manifest.vectors.quantization).toBe("int8");
    expect(manifest.vectors.embeddingProvider).toEqual({ type: "custom" });
    expect(Object.keys(manifest.vectors.shards)).toEqual(["en"]);
  });

  it("lexical-only search misses the semantically-related, lexically-disjoint document", async () => {
    const client = clientWithEmbed();
    const result = await client.search("cancel plan");
    expect(result.hits.map((h) => h.id)).toEqual([1]);
  });

  it('mode: "vector" ranks both concept-related documents above the unrelated one', async () => {
    const client = clientWithEmbed();
    const result = await client.search("cancel plan", { mode: "vector" });
    const ids = result.hits.map((h) => h.id);
    expect(ids.slice(0, 2).sort()).toEqual([1, 2]);
    expect(ids[2]).toBe(3);
    expect(result.hits[2]?.score).toBe(0);
  });

  it('mode: "hybrid" (default RRF) ranks the lexical+vector match first, then folds in the vector-only match', async () => {
    const client = clientWithEmbed();
    const result = await client.search("cancel plan", { mode: "hybrid" });
    expect(result.hits.map((h) => h.id)).toEqual([1, 2, 3]);
    expect(result.totalHits).toBe(3);
  });

  it('mode: "hybrid" with vectorWeight: 1 (pure vector weighting) reorders ahead of RRF\'s default', async () => {
    const client = clientWithEmbed();
    const result = await client.search("cancel plan", {
      mode: "hybrid",
      vectorWeight: 1,
    });
    // Doc 2's cosine similarity to the query is higher than doc 1's
    // (hand-computed: query=[1,1,0,0], doc1=[1,4,0,0] -> cos≈0.857,
    // doc2=[2,3,0,0] -> cos≈0.981) -- a pure-vector weighting surfaces
    // that, unlike RRF's rank-based default above which put doc 1 first
    // because it's the only lexical match too.
    expect(result.hits.map((h) => h.id)).toEqual([2, 1, 3]);
  });

  it("mode: vector/hybrid without embedQuery configured throws VectorSearchNotConfiguredError", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    await expect(
      client.search("cancel plan", { mode: "vector" }),
    ).rejects.toBeInstanceOf(VectorSearchNotConfiguredError);
    await expect(
      client.search("cancel plan", { mode: "hybrid" }),
    ).rejects.toBeInstanceOf(VectorSearchNotConfiguredError);
  });

  it('mode: "lexical" (default) is completely unaffected by embedQuery being configured', async () => {
    const client = clientWithEmbed();
    const result = await client.search("widgets");
    expect(result.hits.map((h) => h.id)).toEqual([3]);
  });
});

/**
 * Issue #1 finding 4 (productization review): `embedQuery` can carry its
 * own `provider` metadata (`{embed, provider}`, the shape
 * `createTransformersEmbedQuery()` returns), which `SearchClient`
 * compares against this index's own `manifest.vectors.embeddingProvider`
 * (recorded above as `{ type: "custom" }`) before ever computing a query
 * vector. A bare-function `embedQuery` (every test above) has no
 * provider to compare, so it's never validated -- that's the documented,
 * intentional tradeoff for a deployment that doesn't use the
 * object form.
 */
describe("vector embedding-provider mismatch validation (real HTTP)", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let outDir: string;

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "searchable-vector-provider-"));
    const built = buildIndex(sources, "en");
    const vectors = await buildVectorShards(sources, "en", {
      embed: embedBatch,
    });
    await writeIndex(built, outDir, { vectors });
    const server = await serveStatic(outDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  afterAll(async () => {
    await closeServer();
    await rm(outDir, { recursive: true, force: true });
  });

  it("a matching provider does not throw", async () => {
    const client = new SearchClient({
      indexUrl: `${baseUrl}manifest.json`,
      embedQuery: { embed: embedText, provider: { type: "custom" } },
    });
    await expect(
      client.search("cancel plan", { mode: "vector" }),
    ).resolves.toBeDefined();
  });

  it("a mismatched provider throws VectorProviderMismatchError before computing a query vector", async () => {
    const client = new SearchClient({
      indexUrl: `${baseUrl}manifest.json`,
      embedQuery: {
        embed: embedText,
        provider: { type: "local-model", model: "wrong/model" },
      },
    });
    await expect(
      client.search("cancel plan", { mode: "vector" }),
    ).rejects.toBeInstanceOf(VectorProviderMismatchError);
  });

  it("validateVectorProvider: false opts out of the check", async () => {
    const client = new SearchClient({
      indexUrl: `${baseUrl}manifest.json`,
      embedQuery: {
        embed: embedText,
        provider: { type: "local-model", model: "wrong/model" },
      },
      validateVectorProvider: false,
    });
    await expect(
      client.search("cancel plan", { mode: "vector" }),
    ).resolves.toBeDefined();
  });

  it("a bare-function embedQuery is never validated (no provider to compare)", async () => {
    const client = new SearchClient({
      indexUrl: `${baseUrl}manifest.json`,
      embedQuery: (query) => embedText(query),
    });
    await expect(
      client.search("cancel plan", { mode: "vector" }),
    ).resolves.toBeDefined();
  });
});
