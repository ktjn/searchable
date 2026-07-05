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
    __csfRunSearch?: (
      query: string,
      useWorker: boolean,
    ) => Promise<Array<{ id: number; url: string }>>;
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientDist = join(__dirname, "..", "dist");

const sources: SourceDocument[] = [
  {
    id: 1,
    url: "/widgets",
    html: `<html lang="en"><head><title>Widgets</title></head>
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
    url: "/about",
    html: `<html lang="en"><head><title>About Us</title></head>
      <body><main><p>We are a small company that makes things.</p></main></body></html>`,
  },
];

test.describe("Web Worker execution (real browser)", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let rootDir: string;

  test.beforeAll(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "csf-browser-e2e-"));
    await cp(clientDist, rootDir, { recursive: true });
    await cp(
      join(__dirname, "fixtures", "harness.html"),
      join(rootDir, "harness.html"),
    );
    await writeIndex(buildIndex(sources), rootDir);

    const server = await serveDir(rootDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  test.afterAll(async () => {
    await closeServer();
    await rm(rootDir, { recursive: true, force: true });
  });

  test("worker:true returns correct, ranked results via a real Worker", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}harness.html`);
    await page.waitForFunction(() => "__csfHarnessReady" in window);

    const hits = await page.evaluate(
      ([query, useWorker]) => window.__csfRunSearch?.(query, useWorker),
      ["widgets", true] as [string, boolean],
    );

    expect(hits?.map((h) => h.id)).toEqual([1, 2]);
    expect(hits?.[0]?.url).toBe("/widgets");
  });

  test("worker:true and worker:false return identical results", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}harness.html`);
    await page.waitForFunction(() => "__csfHarnessReady" in window);

    const [withWorker, withoutWorker] = await page.evaluate(
      async ([query]) => {
        const w = await window.__csfRunSearch?.(query, true);
        const m = await window.__csfRunSearch?.(query, false);
        return [w, m];
      },
      ["widgets"] as [string],
    );

    expect(withWorker).toEqual(withoutWorker);
  });

  test("worker:false runs on the main thread and still returns correct results", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}harness.html`);
    await page.waitForFunction(() => "__csfHarnessReady" in window);

    const hits = await page.evaluate(
      ([query, useWorker]) => window.__csfRunSearch?.(query, useWorker),
      ["company", false] as [string, boolean],
    );

    expect(hits?.map((h) => h.id)).toEqual([3]);
  });
});
