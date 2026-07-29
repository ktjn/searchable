import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { PythonSourceDocument } from "../test-support/python-index.js";
import { writePythonIndex } from "../test-support/python-index.js";
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
    __csfRegisterOfflineTrackInstall?: (
      swPath: string,
      indexUrl: string,
      opts?: Record<string, unknown>,
    ) => Promise<string>;
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientDist = join(__dirname, "..", "dist");

const offlineSources: PythonSourceDocument[] = [
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
  let closeCrossOriginServer: () => Promise<void>;
  let rootDir: string;

  test.beforeAll(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "searchable-browser-e2e-offline-"));
    await cp(clientDist, rootDir, { recursive: true });
    await cp(
      join(__dirname, "fixtures", "harness.html"),
      join(rootDir, "harness.html"),
    );
    const { outDir: pythonOutDir, cleanup: cleanupIndex } =
      await writePythonIndex(offlineSources);
    await cp(pythonOutDir, rootDir, { recursive: true });
    await cleanupIndex();

    // A second, real static server on a different port (a genuinely
    // different origin, same host) serving the identical content -- so
    // the manifest below can point the "en" term shard at a URL that's
    // truly cross-origin *and* actually fetchable, distinguishing "the
    // Service Worker's validateManifest() call rejected this" from "the
    // fetch itself just failed" (which a fake, unreachable domain like
    // https://evil.example.com couldn't tell apart).
    const crossOriginServer = await serveDir(rootDir);
    closeCrossOriginServer = crossOriginServer.close;

    // A manifest whose "en" term shard points at that other origin --
    // used to prove the Service Worker's precache() rejects it via the
    // same validateManifest() cross-origin-shard check the main-thread/
    // Worker query paths already apply, rather than blindly caching (and
    // later serving) whatever URL a compromised/misconfigured manifest
    // names, and that allowCrossOriginShards: true is the one thing that
    // changes that outcome.
    const manifest = JSON.parse(
      await readFile(join(rootDir, "manifest.json"), "utf8"),
    );
    manifest.shards.terms = manifest.shards.terms.map(
      (entry: { lang: string; file: string }) =>
        entry.lang === "en"
          ? { ...entry, file: `${crossOriginServer.baseUrl}${entry.file}` }
          : entry,
    );
    await writeFile(
      join(rootDir, "manifest-cross-origin.json"),
      JSON.stringify(manifest),
      "utf8",
    );

    const server = await serveDir(rootDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  test.afterAll(async () => {
    await closeServer();
    await closeCrossOriginServer();
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

  test("a manifest with a cross-origin shard fails Service Worker install unless allowCrossOriginShards is set", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}harness.html`);
    await page.waitForFunction(() => "__csfHarnessReady" in window);

    const rejectedState = await page.evaluate(
      ([swPath, indexUrl]) =>
        window.__csfRegisterOfflineTrackInstall?.(swPath, indexUrl),
      ["./sw.js", "./manifest-cross-origin.json"] as [string, string],
    );
    expect(rejectedState).toBe("redundant");

    // The failed registration above never activates (redundant, no
    // controller for this scope) -- re-registering the same scope with
    // allowCrossOriginShards set installs cleanly, proving the earlier
    // rejection was specifically the cross-origin-shard check, not
    // something else about this manifest.
    const acceptedState = await page.evaluate(
      ([swPath, indexUrl, opts]) =>
        window.__csfRegisterOfflineTrackInstall?.(swPath, indexUrl, opts),
      [
        "./sw.js",
        "./manifest-cross-origin.json",
        { allowCrossOriginShards: true },
      ] as [string, string, Record<string, unknown>],
    );
    expect(acceptedState).toBe("activated");
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
