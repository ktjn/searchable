import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SourceDocument } from "@ktjn/searchable-indexer";
import { buildIndex, writeIndex } from "@ktjn/searchable-indexer";
import { expect, test } from "@playwright/test";
import { serveDir } from "./serve-dir.js";

declare global {
  interface Window {
    __csfHarnessReady?: boolean;
    __csfRunSearch?: (
      query: string,
      useWorker: boolean,
      options?: Record<string, unknown>,
    ) => Promise<{ hits: Array<{ id: number; url: string; score: number }> }>;
    __csfRunFacetValues?: (
      field: string,
      useWorker: boolean,
    ) => Promise<{
      values: Array<{ value: string; count: number; selected: boolean }>;
    }>;
    __csfRunSearchWithEvents?: (
      query: string,
      useWorker: boolean,
    ) => Promise<
      Array<{
        type: "query" | "result";
        payload: { query: string; options: unknown };
      }>
    >;
    __csfTestDisposeRejectsInFlight?: () => Promise<string | undefined>;
    __csfTestSearchAfterDispose?: () => Promise<string | undefined>;
    __csfTestWorkerFatalError?: () => Promise<string | undefined>;
    __csfTestWorkerManifestValidation?: (
      manifestUrl: string,
    ) => Promise<string | undefined>;
    __csfTestAbortSearch?: (useWorker: boolean) => Promise<string | undefined>;
    __csfRunSearchStream?: (
      query: string,
      useWorker: boolean,
      opts?: Record<string, unknown>,
    ) => Promise<{ partials: number[][]; final: number[] }>;
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientDist = join(__dirname, "..", "dist");

const sources: SourceDocument[] = [
  {
    id: 1,
    url: "/widgets",
    html: `<html lang="en"><head><title>Widgets</title>
      <meta name="searchable-facet-category" content="electronics"></head>
      <body><main><p>Our widgets are wonderful. Buy widgets today.</p></main></body></html>`,
  },
  {
    id: 2,
    url: "/gadgets",
    html: `<html lang="en"><head><title>Gadgets</title>
      <meta name="searchable-facet-category" content="electronics"></head>
      <body><main><p>Gadgets and gizmos, plus a few widgets for good measure.</p></main></body></html>`,
  },
  {
    id: 3,
    url: "/about",
    html: `<html lang="en"><head><title>About Us</title>
      <meta name="searchable-facet-category" content="company"></head>
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

    const result = await page.evaluate(
      ([query, useWorker]) => window.__csfRunSearch?.(query, useWorker),
      ["widgets", true] as [string, boolean],
    );

    expect(result?.hits.map((h) => h.id)).toEqual([1, 2]);
    expect(result?.hits[0]?.url).toBe("/widgets");
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

    const result = await page.evaluate(
      ([query, useWorker]) => window.__csfRunSearch?.(query, useWorker),
      ["company", false] as [string, boolean],
    );

    expect(result?.hits.map((h) => h.id)).toEqual([3]);
  });

  test("facetValues() returns correct contextual counts via a real Worker", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}harness.html`);
    await page.waitForFunction(() => "__csfHarnessReady" in window);

    const result = await page.evaluate(
      ([field, useWorker]) =>
        window.__csfRunFacetValues?.(field as string, useWorker as boolean),
      ["category", true] as [string, boolean],
    );

    expect(
      result?.values.slice().sort((a, b) => a.value.localeCompare(b.value)),
    ).toEqual([
      { value: "company", count: 1, selected: false },
      { value: "electronics", count: 2, selected: false },
    ]);
  });

  test("facetValues() over a Worker matches main-thread results", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}harness.html`);
    await page.waitForFunction(() => "__csfHarnessReady" in window);

    const [withWorker, withoutWorker] = await page.evaluate(async () => {
      const w = await window.__csfRunFacetValues?.("category", true);
      const m = await window.__csfRunFacetValues?.("category", false);
      return [w, m];
    });

    expect(withWorker).toEqual(withoutWorker);
  });

  test("client.on() fires 'query' then 'result' via a real Worker, same as main-thread mode", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}harness.html`);
    await page.waitForFunction(() => "__csfHarnessReady" in window);

    const [withWorker, withoutWorker] = await page.evaluate(async () => {
      const w = await window.__csfRunSearchWithEvents?.("widgets", true);
      const m = await window.__csfRunSearchWithEvents?.("widgets", false);
      return [w, m];
    });

    const expected = [
      { type: "query", payload: { query: "widgets", options: {} } },
      { type: "result", payload: { query: "widgets", options: {} } },
    ];
    expect(withWorker).toEqual(expected);
    expect(withoutWorker).toEqual(expected);
  });

  test("options.signal aborts a search() call via a real Worker, same as main-thread mode", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}harness.html`);
    await page.waitForFunction(() => "__csfHarnessReady" in window);

    const [withWorker, withoutWorker] = await page.evaluate(async () => {
      const w = await window.__csfTestAbortSearch?.(true);
      const m = await window.__csfTestAbortSearch?.(false);
      return [w, m];
    });

    expect(withWorker).toBe("AbortError");
    expect(withoutWorker).toBe("AbortError");
  });
});

test.describe("SearchClient lifecycle (real browser)", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let rootDir: string;

  test.beforeAll(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "csf-browser-e2e-lifecycle-"));
    await cp(clientDist, rootDir, { recursive: true });
    await cp(
      join(__dirname, "fixtures", "harness.html"),
      join(rootDir, "harness.html"),
    );
    await writeIndex(buildIndex(sources), rootDir);
    await writeFile(
      join(rootDir, "bad-manifest.json"),
      JSON.stringify({ version: 2, format: "json" }),
      "utf8",
    );

    const server = await serveDir(rootDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  test.afterAll(async () => {
    await closeServer();
    await rm(rootDir, { recursive: true, force: true });
  });

  test("dispose() rejects an in-flight request instead of hanging forever", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}harness.html`);
    await page.waitForFunction(() => "__csfHarnessReady" in window);

    const message = await page.evaluate(() =>
      window.__csfTestDisposeRejectsInFlight?.(),
    );
    expect(message).toContain("disposed");
  });

  test("search() after dispose() rejects rather than hitting a dead worker", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}harness.html`);
    await page.waitForFunction(() => "__csfHarnessReady" in window);

    const message = await page.evaluate(() =>
      window.__csfTestSearchAfterDispose?.(),
    );
    expect(message).toContain("disposed");
  });

  test("a fatal worker error (failed script load) rejects ready() with a clear error", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}harness.html`);
    await page.waitForFunction(() => "__csfHarnessReady" in window);

    const message = await page.evaluate(() =>
      window.__csfTestWorkerFatalError?.(),
    );
    expect(message).toBeDefined();
  });

  test("a structurally invalid manifest is rejected inside the worker, not just the main thread", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}harness.html`);
    await page.waitForFunction(() => "__csfHarnessReady" in window);

    const message = await page.evaluate(
      (manifestUrl) => window.__csfTestWorkerManifestValidation?.(manifestUrl),
      "./bad-manifest.json",
    );
    expect(message).toContain("invalid manifest");
  });
});

test.describe("searchStream() (real browser)", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let rootDir: string;

  const streamSources: SourceDocument[] = [
    {
      id: 1,
      url: "/widget",
      html: `<html lang="en"><head><title>Widget Page</title></head>
        <body><main><p>All about the widget.</p></main></body></html>`,
    },
    {
      id: 2,
      url: "/widgit-literal",
      html: `<html lang="en"><head><title>Widgit Literal</title></head>
        <body><main><p>This page literally says widgit, on purpose.</p></main></body></html>`,
    },
  ];

  test.beforeAll(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "csf-browser-e2e-searchstream-"));
    await cp(clientDist, rootDir, { recursive: true });
    await cp(
      join(__dirname, "fixtures", "harness.html"),
      join(rootDir, "harness.html"),
    );
    await writeIndex(buildIndex(streamSources, "en", { fuzzy: true }), rootDir);

    const server = await serveDir(rootDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  test.afterAll(async () => {
    await closeServer();
    await rm(rootDir, { recursive: true, force: true });
  });

  test("delivers the literal-only pass via onPartial before resolving to the fuzzy-expanded final result, via a real Worker", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}harness.html`);
    await page.waitForFunction(() => "__csfHarnessReady" in window);

    const result = await page.evaluate(
      ([query, useWorker, opts]) =>
        window.__csfRunSearchStream?.(
          query as string,
          useWorker as boolean,
          opts as Record<string, unknown>,
        ),
      ["widgit", true, { fuzzy: true }] as [
        string,
        boolean,
        Record<string, unknown>,
      ],
    );

    expect(result?.partials).toEqual([[2]]);
    expect(result?.final).toEqual([2, 1]);
  });

  test("worker:true and worker:false deliver identical partial/final events", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}harness.html`);
    await page.waitForFunction(() => "__csfHarnessReady" in window);

    const [withWorker, withoutWorker] = await page.evaluate(async () => {
      const w = await window.__csfRunSearchStream?.("widgit", true, {
        fuzzy: true,
      });
      const m = await window.__csfRunSearchStream?.("widgit", false, {
        fuzzy: true,
      });
      return [w, m];
    });

    expect(withWorker).toEqual(withoutWorker);
  });
});
