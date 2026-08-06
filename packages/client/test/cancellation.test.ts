import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchClient } from "../src/client.js";
import { FakeWorker } from "../test-support/fake-worker.js";

/**
 * Phase 1 (follow-up remediation): cancellation must be prompt across every
 * awaited caller-visible operation -- readiness (worker init or direct-mode
 * manifest load) and query embeddings -- while never cancelling the shared
 * underlying work. All timing is driven by deferred promises, never sleeps.
 */

const INDEX_URL = "https://example.com/index/manifest.json";
const WORKER_URL = "https://example.com/worker.js";

const VALID_MANIFEST = {
  version: 1,
  format: "json",
  languages: ["en"],
  defaultLanguage: "en",
  fields: {},
  docCount: { en: 0 },
  avgFieldLength: { en: 0 },
  shards: { terms: [], docs: [] },
};

/**
 * Flushes the microtask queue and one macrotask. Used to let an async
 * `search()` progress into its embedding await *before* the test aborts,
 * so the abort lands on the embedding (not on the readiness race). A
 * scheduling primitive, not a wall-clock sleep.
 */
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function makeDirectClient(): SearchClient {
  return new SearchClient({ indexUrl: INDEX_URL, worker: false });
}

describe("prompt cancellation across initialization and embeddings", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete (globalThis as { Worker?: unknown }).Worker;
  });

  describe("while Worker initialization is pending", () => {
    beforeEach(() => {
      FakeWorker.instances = [];
      FakeWorker.autoReply = false;
      FakeWorker.initScenario = { kind: "ok", protocolVersion: 2 };
      (globalThis as { Worker?: unknown }).Worker = FakeWorker;
    });

    it("rejects with AbortError immediately, without waiting for init, and the init still completes", async () => {
      const client = new SearchClient({
        indexUrl: INDEX_URL,
        worker: true,
        workerUrl: WORKER_URL,
      });
      client.ready().catch(() => {});
      const worker = FakeWorker.instances[0] as FakeWorker | undefined;

      const controller = new AbortController();
      const pending = client.search("widgets", { signal: controller.signal });
      controller.abort();

      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      expect(worker?.terminated).toBe(false);

      // The shared init was not cancelled by the abort -- it completes on
      // its own and readiness resolves.
      worker?.replyInitResult();
      await expect(client.ready()).resolves.toBeUndefined();
    });
  });

  describe("while direct-mode manifest loading is pending", () => {
    it("rejects with AbortError immediately and the manifest load still completes", async () => {
      let resolveFetch!: (value: unknown) => void;
      globalThis.fetch = vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      ) as unknown as typeof fetch;

      const client = makeDirectClient();
      client.ready().catch(() => {});

      const controller = new AbortController();
      const pending = client.search("widgets", { signal: controller.signal });
      controller.abort();

      await expect(pending).rejects.toMatchObject({ name: "AbortError" });

      // The deferred manifest fetch -- shared across all callers -- was not
      // cancelled, and readiness resolves once it lands.
      resolveFetch({ ok: true, json: async () => VALID_MANIFEST });
      await expect(client.ready()).resolves.toBeUndefined();
    });
  });

  describe("while embedQuery() is pending", () => {
    it("rejects with AbortError after readiness, lets the embedding finish, and emits no result event", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => VALID_MANIFEST,
      }) as unknown as typeof fetch;

      let resolveEmbed!: (vector: number[]) => void;
      const embedMock = vi.fn(
        () =>
          new Promise<number[]>((resolve) => {
            resolveEmbed = resolve;
          }),
      );

      const client = new SearchClient({
        indexUrl: INDEX_URL,
        worker: false,
        embedQuery: embedMock,
      });
      await client.ready();

      const events: string[] = [];
      client.on("query", () => events.push("query"));
      client.on("result", () => events.push("result"));

      const controller = new AbortController();
      const pending = client.search("widgets", {
        mode: "vector",
        signal: controller.signal,
      });
      // Let search() get past the (already-resolved) readiness race and
      // onto the pending embedding before aborting.
      await tick();
      controller.abort();

      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      expect(events).toEqual([]);

      // The embedding promise may complete afterwards -- nothing is
      // delivered to the caller who already aborted.
      resolveEmbed([0.1, 0.2]);
      await Promise.resolve();
      await Promise.resolve();
      expect(events).toEqual([]);
    });

    it("leaves the client fully usable for a later call after an aborted embedding", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => VALID_MANIFEST,
      }) as unknown as typeof fetch;

      const embedMock = vi.fn(() => new Promise<number[]>(() => undefined));
      const client = new SearchClient({
        indexUrl: INDEX_URL,
        worker: false,
        embedQuery: embedMock,
      });
      await client.ready();

      const controller = new AbortController();
      const pending = client.search("widgets", {
        mode: "vector",
        signal: controller.signal,
      });
      await tick();
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });

      // The cancelled embedding didn't take the client down with it -- a
      // later, un-aborted call still works.
      const result = await client.search("widgets");
      expect(result.hits).toEqual([]);
    });
  });
});
