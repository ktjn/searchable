import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SourceDocument } from "@csf/indexer";
import { buildIndex, buildVectorShards, writeIndex } from "@csf/indexer";
import { expect, test } from "@playwright/test";
import { serveDir } from "./serve-dir.js";

declare global {
  interface Window {
    __csfRegisterOffline?: (
      swPath: string,
      indexUrl: string,
      opts?: Record<string, unknown>,
    ) => Promise<void>;
    __csfOfflineCacheUrls?: () => Promise<string[]>;
    __csfManifestFuzzyShardFiles?: (
      indexUrl: string,
    ) => Promise<Record<string, string>>;
    __csfManifestVectorShardFiles?: (
      indexUrl: string,
    ) => Promise<Record<string, string>>;
    __csfRunSearch?: (
      query: string,
      useWorker: boolean,
      options?: Record<string, unknown>,
    ) => Promise<{ hits: Array<{ id: number; url: string; score: number }> }>;
    __csfRunVectorSearch?: (
      query: string,
      useWorker: boolean,
      options: Record<string, unknown>,
    ) => Promise<{ hits: Array<{ id: number; url: string; score: number }> }>;
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientDist = join(__dirname, "..", "dist");

/**
 * Regression coverage for issue #1 finding 1
 * (docs/08-modern-features.md#caching--offline-support): the Service
 * Worker previously mishandled `manifest.fuzzy` (an object shape, not a
 * bare file string like `pins`/`synonyms`) and never precached
 * `manifest.vectors` shards at all, so `fuzzy: true` and
 * `mode: "vector"`/`"hybrid"` couldn't actually be considered
 * offline-ready. This proves both are now genuinely offline-capable --
 * not just "the shard bytes are in the cache" but a real fuzzy/vector/
 * hybrid query, run fully offline, still returns correct results.
 */

/** Same deterministic "concept bucket" embedder as vector-search.spec.ts. */
const CONCEPT_BUCKETS: string[][] = [
  ["cancel", "closing", "close"],
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

test.describe("offline Service Worker caching: fuzzy + vector/hybrid (real browser)", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let rootDir: string;

  test.beforeAll(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "csf-browser-e2e-offline-fv-"));
    await cp(clientDist, rootDir, { recursive: true });
    await cp(
      join(__dirname, "fixtures", "harness.html"),
      join(rootDir, "harness.html"),
    );
    const built = buildIndex(sources, "en", { fuzzy: true });
    const vectors = await buildVectorShards(sources, "en", {
      embed: (texts) => texts.map(embedText),
    });
    await writeIndex(built, rootDir, { vectors });

    const server = await serveDir(rootDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  test.afterAll(async () => {
    await closeServer();
    await rm(rootDir, { recursive: true, force: true });
  });

  test("precaches the fuzzy shard and the vector shard, not just term/doc shards", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}harness.html`);
    await page.waitForFunction(() => "__csfHarnessReady" in window);

    await page.evaluate(
      ([swPath, indexUrl]) => window.__csfRegisterOffline?.(swPath, indexUrl),
      ["./sw.js", "./manifest.json"] as [string, string],
    );

    const [cachedUrls, fuzzyFiles, vectorFiles] = await page.evaluate(
      async () => [
        await window.__csfOfflineCacheUrls?.(),
        await window.__csfManifestFuzzyShardFiles?.("./manifest.json"),
        await window.__csfManifestVectorShardFiles?.("./manifest.json"),
      ],
    );

    expect(fuzzyFiles?.en).toBeTruthy();
    expect(vectorFiles?.en).toBeTruthy();
    expect(cachedUrls).toContain(fuzzyFiles?.en);
    expect(cachedUrls).toContain(vectorFiles?.en);
  });

  test("fuzzy matching finds a one-edit-distance typo while fully offline", async ({
    page,
    context,
  }) => {
    await page.goto(`${baseUrl}harness.html`);
    await page.waitForFunction(() => "__csfHarnessReady" in window);

    await page.evaluate(
      ([swPath, indexUrl]) => window.__csfRegisterOffline?.(swPath, indexUrl),
      ["./sw.js", "./manifest.json"] as [string, string],
    );

    await context.setOffline(true);
    // "gadet" is a genuine one-deletion typo of "gadget" (doc 3's
    // stemmed term, "gadgets" -> "gadget" via English Porter stemming).
    const result = await page.evaluate(
      ([query, useWorker, options]) =>
        window.__csfRunSearch?.(
          query as string,
          useWorker as boolean,
          options as Record<string, unknown>,
        ),
      ["gadet", false, { fuzzy: true }] as [
        string,
        boolean,
        Record<string, unknown>,
      ],
    );
    await context.setOffline(false);

    expect(result?.hits.map((h) => h.id)).toContain(3);
  });

  test("mode: 'vector' finds the concept-related, lexically-disjoint document while fully offline", async ({
    page,
    context,
  }) => {
    await page.goto(`${baseUrl}harness.html`);
    await page.waitForFunction(() => "__csfHarnessReady" in window);

    await page.evaluate(
      ([swPath, indexUrl]) => window.__csfRegisterOffline?.(swPath, indexUrl),
      ["./sw.js", "./manifest.json"] as [string, string],
    );

    await context.setOffline(true);
    const result = await page.evaluate(
      ([query, useWorker, options]) =>
        window.__csfRunVectorSearch?.(
          query as string,
          useWorker as boolean,
          options as Record<string, unknown>,
        ),
      ["cancel plan", false, { mode: "vector" }] as [
        string,
        boolean,
        Record<string, unknown>,
      ],
    );
    await context.setOffline(false);

    expect(result?.hits.map((h) => h.id).sort()).toEqual([1, 2, 3]);
    const doc3 = result?.hits.find((h) => h.id === 3);
    expect(doc3?.score).toBe(0);
  });

  test("mode: 'hybrid' returns the same results offline as online", async ({
    page,
    context,
  }) => {
    await page.goto(`${baseUrl}harness.html`);
    await page.waitForFunction(() => "__csfHarnessReady" in window);

    const online = await page.evaluate(
      ([query, useWorker, options]) =>
        window.__csfRunVectorSearch?.(
          query as string,
          useWorker as boolean,
          options as Record<string, unknown>,
        ),
      ["cancel plan", false, { mode: "hybrid" }] as [
        string,
        boolean,
        Record<string, unknown>,
      ],
    );

    await page.evaluate(
      ([swPath, indexUrl]) => window.__csfRegisterOffline?.(swPath, indexUrl),
      ["./sw.js", "./manifest.json"] as [string, string],
    );
    await context.setOffline(true);
    const offline = await page.evaluate(
      ([query, useWorker, options]) =>
        window.__csfRunVectorSearch?.(
          query as string,
          useWorker as boolean,
          options as Record<string, unknown>,
        ),
      ["cancel plan", false, { mode: "hybrid" }] as [
        string,
        boolean,
        Record<string, unknown>,
      ],
    );
    await context.setOffline(false);

    expect(offline).toEqual(online);
  });
});
