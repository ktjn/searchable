import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex, writeIndex } from "@csf/indexer";
import type { SourceDocument } from "@csf/indexer";
import { expect, test } from "@playwright/test";
import { serveDir } from "./serve-dir.js";

declare global {
  interface Window {
    __csfHarnessReady?: boolean;
    __csfRegisterOffline?: (
      swPath: string,
      indexUrl: string,
      opts?: Record<string, unknown>,
    ) => Promise<void>;
    __csfOfflineCacheUrls?: () => Promise<string[]>;
    __csfManifestTermShardFiles?: (
      indexUrl: string,
    ) => Promise<Record<string, string>>;
    __csfFetchStatus?: (url: string) => Promise<number | string>;
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientDist = join(__dirname, "..", "dist");

const offlineSources: SourceDocument[] = [
  {
    id: 1,
    url: "/en/widgets",
    html: `<html lang="en"><head><title>Widgets</title></head>
      <body><main><p>All about widgets.</p></main></body></html>`,
  },
  {
    id: 2,
    url: "/de/preise",
    html: `<html lang="de"><head><title>Preise</title></head>
      <body><main><p>Unsere Preise sind fair.</p></main></body></html>`,
  },
];

test.describe("offline Service Worker caching (real browser)", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let rootDir: string;

  test.beforeAll(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "csf-browser-e2e-offline-"));
    await cp(clientDist, rootDir, { recursive: true });
    await cp(
      join(__dirname, "fixtures", "harness.html"),
      join(rootDir, "harness.html"),
    );
    await writeIndex(buildIndex(offlineSources), rootDir);

    const server = await serveDir(rootDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  test.afterAll(async () => {
    await closeServer();
    await rm(rootDir, { recursive: true, force: true });
  });

  test("precaches the manifest and every language's shard on install, servable fully offline (cache-first, the default)", async ({
    page,
    context,
  }) => {
    await page.goto(`${baseUrl}harness.html`);
    await page.waitForFunction(() => "__csfHarnessReady" in window);

    await page.evaluate(
      ([swPath, indexUrl]) => window.__csfRegisterOffline?.(swPath, indexUrl),
      ["./sw.js", "./manifest.json"] as [string, string],
    );

    const [cachedUrls, shardFiles] = await page.evaluate(async () => [
      await window.__csfOfflineCacheUrls?.(),
      await window.__csfManifestTermShardFiles?.("./manifest.json"),
    ]);

    expect(cachedUrls?.some((u) => u.endsWith("/manifest.json"))).toBe(true);
    expect(cachedUrls).toContain(shardFiles?.en);
    expect(cachedUrls).toContain(shardFiles?.de);

    await context.setOffline(true);
    const status = await page.evaluate(
      (indexUrl) => window.__csfFetchStatus?.(indexUrl),
      `${baseUrl}manifest.json`,
    );
    expect(status).toBe(200);
    await context.setOffline(false);
  });

  test("options.languages restricts precaching to the selected language's term shard only", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}harness.html`);
    await page.waitForFunction(() => "__csfHarnessReady" in window);

    await page.evaluate(
      ([swPath, indexUrl, opts]) =>
        window.__csfRegisterOffline?.(swPath, indexUrl, opts),
      ["./sw.js", "./manifest.json", { languages: ["en"] }] as [
        string,
        string,
        Record<string, unknown>,
      ],
    );

    const [cachedUrls, shardFiles] = await page.evaluate(async () => [
      await window.__csfOfflineCacheUrls?.(),
      await window.__csfManifestTermShardFiles?.("./manifest.json"),
    ]);

    expect(cachedUrls).toContain(shardFiles?.en);
    expect(cachedUrls).not.toContain(shardFiles?.de);
  });

  test("mode: 'stale-while-revalidate' also serves the manifest while fully offline", async ({
    page,
    context,
  }) => {
    await page.goto(`${baseUrl}harness.html`);
    await page.waitForFunction(() => "__csfHarnessReady" in window);

    await page.evaluate(
      ([swPath, indexUrl, opts]) =>
        window.__csfRegisterOffline?.(swPath, indexUrl, opts),
      ["./sw.js", "./manifest.json", { mode: "stale-while-revalidate" }] as [
        string,
        string,
        Record<string, unknown>,
      ],
    );

    await context.setOffline(true);
    const status = await page.evaluate(
      (indexUrl) => window.__csfFetchStatus?.(indexUrl),
      `${baseUrl}manifest.json`,
    );
    expect(status).toBe(200);
    await context.setOffline(false);
  });
});
