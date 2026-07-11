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
    __csfRunVectorSearch?: (
      query: string,
      useWorker: boolean,
      options: Record<string, unknown>,
    ) => Promise<{ hits: Array<{ id: number; url: string; score: number }> }>;
    __csfRunVectorSearchWithProvider?: (
      query: string,
      useWorker: boolean,
      options: Record<string, unknown>,
      provider: Record<string, unknown>,
      validateVectorProvider?: boolean,
    ) => Promise<
      | { ok: true; result: { hits: Array<{ id: number; score: number }> } }
      | { ok: false; name: string; message: string }
    >;
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientDist = join(__dirname, "..", "dist");

/** Same deterministic "concept bucket" embedder as packages/client/test/vector-hybrid-search.test.ts, duplicated into fixtures/harness.html's `__csfRunVectorSearch` for the browser side -- see that file for why this proves something real despite not being a genuine embedding model. */
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

test.describe("vector/hybrid search (real browser, real Worker)", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let rootDir: string;

  test.beforeAll(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "csf-browser-e2e-vector-"));
    await cp(clientDist, rootDir, { recursive: true });
    await cp(
      join(__dirname, "fixtures", "harness.html"),
      join(rootDir, "harness.html"),
    );
    const built = buildIndex(sources, "en");
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

  test("mode: 'vector' finds the lexically-disjoint, concept-related document via a real Worker", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}harness.html`);
    await page.waitForFunction(() => "__csfHarnessReady" in window);

    const result = await page.evaluate(
      ([query, useWorker, options]) =>
        window.__csfRunVectorSearch?.(
          query as string,
          useWorker as boolean,
          options as Record<string, unknown>,
        ),
      ["cancel plan", true, { mode: "vector" }] as [
        string,
        boolean,
        Record<string, unknown>,
      ],
    );

    expect(result?.hits.map((h) => h.id).sort()).toEqual([1, 2, 3]);
    // Doc 3 (widgets, unrelated) has zero concept overlap with the query.
    const doc3 = result?.hits.find((h) => h.id === 3);
    expect(doc3?.score).toBe(0);
  });

  test("mode: 'hybrid' via a real Worker matches main-thread (worker: false) results exactly", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}harness.html`);
    await page.waitForFunction(() => "__csfHarnessReady" in window);

    const [withWorker, withoutWorker] = await page.evaluate(async () => {
      const w = await window.__csfRunVectorSearch?.("cancel plan", true, {
        mode: "hybrid",
      });
      const m = await window.__csfRunVectorSearch?.("cancel plan", false, {
        mode: "hybrid",
      });
      return [w, m];
    });

    expect(withWorker).toEqual(withoutWorker);
    expect(withWorker?.hits.map((h) => h.id)).toEqual([1, 2, 3]);
  });

  test("mismatched embedQuery provider throws VectorProviderMismatchError via a real Worker (issue #1 finding 4)", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}harness.html`);
    await page.waitForFunction(() => "__csfHarnessReady" in window);

    // This corpus's vectors were built with no explicit `provider` option
    // (buildVectorShards() defaults to {type: "custom"}) -- in worker
    // mode this exercises SearchClient's lazy second manifest fetch on
    // the main thread (the Worker holds its own copy internally), the
    // code path unique to provider validation under worker: true.
    const outcome = await page.evaluate(
      ([query, useWorker, options, provider]) =>
        window.__csfRunVectorSearchWithProvider?.(
          query as string,
          useWorker as boolean,
          options as Record<string, unknown>,
          provider as Record<string, unknown>,
        ),
      [
        "cancel plan",
        true,
        { mode: "vector" },
        { type: "local-model", model: "wrong/model" },
      ] as [string, boolean, Record<string, unknown>, Record<string, unknown>],
    );

    expect(outcome?.ok).toBe(false);
    expect(outcome && !outcome.ok && outcome.name).toBe(
      "VectorProviderMismatchError",
    );
  });

  test("a matching embedQuery provider does not throw via a real Worker", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}harness.html`);
    await page.waitForFunction(() => "__csfHarnessReady" in window);

    const outcome = await page.evaluate(
      ([query, useWorker, options, provider]) =>
        window.__csfRunVectorSearchWithProvider?.(
          query as string,
          useWorker as boolean,
          options as Record<string, unknown>,
          provider as Record<string, unknown>,
        ),
      ["cancel plan", true, { mode: "vector" }, { type: "custom" }] as [
        string,
        boolean,
        Record<string, unknown>,
        Record<string, unknown>,
      ],
    );

    expect(outcome?.ok).toBe(true);
  });
});
