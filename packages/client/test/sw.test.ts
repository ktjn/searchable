import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lifecycle coverage for the offline Service Worker (sw.ts) run in plain
 * Node: a fake `self`/`caches`/`fetch` environment drives the `fetch`
 * handler with a controllable Cache API, proving:
 *
 * - stale-while-revalidate keeps `waitUntil()` pending until a successful
 *   cache write has persisted (Phase 6), and
 * - the *manifest* URL under stale-while-revalidate goes through the same
 *   atomic transaction as installation -- shards are committed before the
 *   manifest, and any failure leaves the previous manifest authoritative
 *   (final remediation Phase 1).
 */

type FetchHandler = (event: FetchEventLike) => void;

interface FetchEventLike {
  request: Request;
  respondedWith?: Promise<Response>;
  waitUntilPromises: Promise<unknown>[];
  respondWith(promise: Promise<Response>): void;
  waitUntil(promise: Promise<unknown>): void;
}

/** Minimal flockable CacheStorage/Cache used to observe writes deterministically. */
class FakeCache {
  store = new Map<string, Response>();
  /** When set, every put() awaits this gate so a test can hold writes pending. */
  putGate?: Promise<void>;
  /** Per-URL gates used to hold one specific shard write pending. */
  putDelays = new Map<string, Promise<void>>();
  /** URLs whose put() should throw (simulating a failing cache write). */
  putErrors = new Set<string>();
  /** Every URL written, in order -- proves the manifest is committed last. */
  putOrder: string[] = [];

  async match(request: Request | string): Promise<Response | undefined> {
    const url = typeof request === "string" ? request : request.url;
    const entry = this.store.get(url);
    return entry ? entry.clone() : undefined;
  }

  async put(request: Request | string, response: Response): Promise<void> {
    const url = typeof request === "string" ? request : request.url;
    this.putOrder.push(url);
    if (this.putErrors.has(url)) {
      throw new TypeError(`cache write failed for ${url}`);
    }
    const delay = this.putDelays.get(url);
    if (delay) await delay;
    if (this.putGate) await this.putGate;
    this.store.set(url, response.clone());
  }
}

const CACHE_NAME = "searchable-offline";
const INDEX_URL = "http://example.com/index/manifest.json";
const INDEX_DIR = "http://example.com/index/";
const EN_SHARD = `${INDEX_DIR}terms/en/all.json`;
const DE_SHARD = `${INDEX_DIR}terms/de/all.json`;
const DOCS_SHARD = `${INDEX_DIR}docs/all.json`;

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

const okJson = (data: unknown) =>
  new Response(JSON.stringify(data), { status: 200 });

/** A minimal valid Manifest fixture with an en + de term shard and a doc shard. */
const MANIFEST = {
  version: 1,
  format: "json",
  languages: ["en", "de"],
  defaultLanguage: "en",
  fields: {},
  docCount: { en: 1, de: 1 },
  avgFieldLength: { en: 1, de: 1 },
  shards: {
    terms: [
      { lang: "en", prefix: "all", file: "terms/en/all.json" },
      { lang: "de", prefix: "all", file: "terms/de/all.json" },
    ],
    docs: [{ idRange: [0, 1], file: "docs/all.json" }],
  },
};

const PREVIOUS_MANIFEST_BODY = '{"version":1,"build":"A"}';

function buildWorkerUrl(mode: "cache-first" | "stale-while-revalidate") {
  return `http://example.com/sw.js?indexUrl=${encodeURIComponent(INDEX_URL)}&mode=${mode}`;
}

describe("offline Service Worker fetch lifecycle (sw.ts)", () => {
  let listeners: Map<string, Set<FetchHandler>>;
  let cache: FakeCache;
  let fetchMock: ReturnType<typeof vi.fn>;
  let workerSelf: {
    location: { href: string };
  };

  beforeAll(async () => {
    listeners = new Map();
    cache = new FakeCache();
    workerSelf = {
      location: { href: buildWorkerUrl("stale-while-revalidate") },
    };
    (globalThis as { self?: unknown }).self = {
      location: workerSelf.location,
      addEventListener: (type: string, handler: FetchHandler) => {
        let set = listeners.get(type);
        if (!set) {
          set = new Set();
          listeners.set(type, set);
        }
        set.add(handler);
      },
      skipWaiting: vi.fn(),
      clients: { claim: vi.fn() },
    };
    (globalThis as { caches?: unknown }).caches = {
      open: async (name: string) => {
        expect(name).toBe(CACHE_NAME);
        return cache;
      },
    };
    await import("../src/sw.js");
  });

  beforeEach(() => {
    cache.store = new Map();
    cache.putGate = undefined;
    cache.putDelays = new Map();
    cache.putErrors = new Set();
    cache.putOrder = [];
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    // Default mode; the SW fetch handler parses self.location.href per call.
    // `self.location` aliases this same object, so mutating href is seen.
    workerSelf.location.href = buildWorkerUrl("stale-while-revalidate");
  });

  function dispatch(request: Request): FetchEventLike {
    const event: FetchEventLike = {
      request,
      waitUntilPromises: [],
      respondWith(promise: Promise<Response>) {
        this.respondedWith = promise;
      },
      waitUntil(promise: Promise<unknown>) {
        this.waitUntilPromises.push(promise);
      },
    };
    for (const handler of listeners.get("fetch") ?? []) {
      handler(event);
    }
    return event;
  }

  function requestFor(path: string): Request {
    return new Request(`${INDEX_DIR}${path}`);
  }

  async function servedResponseOf(event: FetchEventLike): Promise<Response> {
    if (!event.respondedWith) throw new Error("handler did not respondWith");
    return event.respondedWith;
  }

  /**
   * Resolves once every waitUntil task has been registered AND settles
   * (success or failure). The async fetch handlers register their waitUntil
   * on a later microtask, so this first waits for the array to be populated
   * rather than `Promise.all([])` resolving instantly.
   */
  async function settledWaitUntil(event: FetchEventLike): Promise<void> {
    for (let i = 0; i < 100; i++) {
      if (event.waitUntilPromises.length > 0) {
        await Promise.all(
          event.waitUntilPromises.map((p) =>
            p.then(() => undefined, () => undefined),
          ),
        );
        return;
      }
      await flush();
    }
    throw new Error("handler never registered a waitUntil task");
  }

  /** A per-URL fetch responder that serves a valid manifest + all shards by default. Also installs it as the global fetch and records calls on `fetchMock`. */
  function mockIndexFetch(
    overrides: Partial<{
      manifest: () => Response;
      shards: (url: string) => Response | undefined;
    }> = {},
  ) {
    fetchMock = vi.fn(
      (input: RequestInfo | URL): Promise<Response> => {
        const url = typeof input === "string" ? String(input) : String(input);
        if (url === INDEX_URL) {
          return Promise.resolve(overrides.manifest?.() ?? okJson(MANIFEST));
        }
        const shard = overrides.shards?.(url);
        if (shard) return Promise.resolve(shard);
        return Promise.resolve(okJson({ shard: url }));
      },
    );
    globalThis.fetch = fetchMock;
  }

  /**
   * Generic stale-while-revalidate on a NON-manifest file: waits for cache
   * persistence and never poisons the cache on failure.
   */
  describe("stale-while-revalidate on shard files", () => {
    it("keeps waitUntil() pending until a successful cache.put() resolves, then caches the fresh body", async () => {
      cache.store.set(`${INDEX_DIR}content.json`, okJson({ cached: true }));
      fetchMock.mockResolvedValue(okJson({ fresh: true }));

      let releasePut!: () => void;
      cache.putGate = new Promise<void>((resolve) => {
        releasePut = resolve;
      });

      const event = dispatch(requestFor("content.json"));

      // The stale cached response is served right away...
      const served = await servedResponseOf(event);
      expect(await served.text()).toBe('{"cached":true}');

      // ...but the refresh task (and with it the SW lifetime) stays pending
      // until the cache write has actually persisted.
      let refreshSettled = false;
      event.waitUntilPromises[0]?.then(
        () => {
          refreshSettled = true;
        },
        () => {
          refreshSettled = true;
        },
      );
      await flush();
      await flush();
      expect(refreshSettled).toBe(false);

      releasePut();
      await flush();
      await flush();
      expect(refreshSettled).toBe(true);
      expect(
        await cache.store.get(`${INDEX_DIR}content.json`)?.text(),
      ).toBe('{"fresh":true}');
    });

    it("serves the fresh network response and persists it when no cached entry exists", async () => {
      fetchMock.mockResolvedValue(okJson({ fresh: true }));

      const event = dispatch(requestFor("content.json"));

      const served = await servedResponseOf(event);
      expect(await served.text()).toBe('{"fresh":true}');
      expect(
        await cache.store.get(`${INDEX_DIR}content.json`)?.text(),
      ).toBe('{"fresh":true}');
    });

    it("a failed network request stalls the refresh but never replaces the cached entry", async () => {
      cache.store.set(`${INDEX_DIR}content.json`, okJson({ cached: true }));
      fetchMock.mockRejectedValue(new TypeError("network down"));

      const event = dispatch(requestFor("content.json"));

      const served = await servedResponseOf(event);
      expect(await served.text()).toBe('{"cached":true}');
      await settledWaitUntil(event);
      expect(
        await cache.store.get(`${INDEX_DIR}content.json`)?.text(),
      ).toBe('{"cached":true}');
    });

    it("returns a non-OK network response when nothing is cached, without caching it", async () => {
      fetchMock.mockResolvedValue(new Response("not found", { status: 404 }));

      const event = dispatch(requestFor("missing.txt"));

      const served = await servedResponseOf(event);
      expect(served.status).toBe(404);
      expect(cache.store.has(`${INDEX_DIR}missing.txt`)).toBe(false);
    });

    it("a non-OK refresh does not replace an existing good cached response", async () => {
      cache.store.set(`${INDEX_DIR}content.json`, okJson({ cached: true }));
      fetchMock.mockResolvedValue(
        new Response("server error", { status: 500 }),
      );

      const event = dispatch(requestFor("content.json"));

      const served = await servedResponseOf(event);
      expect(await served.text()).toBe('{"cached":true}');
      await settledWaitUntil(event);
      expect(
        await cache.store.get(`${INDEX_DIR}content.json`)?.text(),
      ).toBe('{"cached":true}');
    });
  });

  /**
   * The manifest URL under stale-while-revalidate uses the same atomic
   * transaction as installation: shards are committed before the manifest,
   * and any failure leaves the previous manifest authoritative.
   */
  describe("atomic runtime manifest refresh (manifest URL under SWR)", () => {
    it("commits every selected shard before the manifest, and the served response stays readable", async () => {
      cache.store.set(INDEX_URL, new Response(PREVIOUS_MANIFEST_BODY));
      mockIndexFetch();

      const event = dispatch(requestFor("manifest.json"));

      // The cached (build A) manifest is served immediately.
      const served = await servedResponseOf(event);
      expect(await served.text()).toBe(PREVIOUS_MANIFEST_BODY);

      await settledWaitUntil(event);

      // Shards were written before the manifest (manifest is commit last).
      expect(cache.putOrder).toEqual([EN_SHARD, DE_SHARD, DOCS_SHARD, INDEX_URL]);
      expect(
        await cache.store.get(INDEX_URL)?.text(),
      ).toBe(JSON.stringify(MANIFEST));
      expect(await cache.store.get(EN_SHARD)?.text()).toBe(
        JSON.stringify({ shard: EN_SHARD }),
      );
      expect(await cache.store.get(DE_SHARD)?.text()).toBe(
        JSON.stringify({ shard: DE_SHARD }),
      );
      expect(await cache.store.get(DOCS_SHARD)?.text()).toBe(
        JSON.stringify({ shard: DOCS_SHARD }),
      );
    });

    it("holds the manifest write until a slow shard write has resolved", async () => {
      cache.store.set(INDEX_URL, new Response(PREVIOUS_MANIFEST_BODY));
      mockIndexFetch();

      let releaseDocsPut!: () => void;
      cache.putDelays.set(
        DOCS_SHARD,
        new Promise<void>((resolve) => {
          releaseDocsPut = resolve;
        }),
      );

      const event = dispatch(requestFor("manifest.json"));
      await servedResponseOf(event);
      await flush();
      await flush();

      // The docs shard write is held -> the manifest must not be committed yet.
      expect(cache.store.has(INDEX_URL)).toBe(true);
      expect(await cache.store.get(INDEX_URL)?.text()).toBe(
        PREVIOUS_MANIFEST_BODY,
      );
      expect(cache.store.has(DOCS_SHARD)).toBe(false);

      releaseDocsPut();
      await settledWaitUntil(event);

      expect(await cache.store.get(INDEX_URL)?.text()).toBe(
        JSON.stringify(MANIFEST),
      );
      expect(cache.putOrder.at(-1)).toBe(INDEX_URL);
    });

    it("a failed shard fetch leaves the previous manifest untouched", async () => {
      cache.store.set(INDEX_URL, new Response(PREVIOUS_MANIFEST_BODY));
      globalThis.fetch = mockIndexFetch({
        shards: (url) =>
          url === DE_SHARD
            ? new Response("no", { status: 404 })
            : undefined,
      });

      const event = dispatch(requestFor("manifest.json"));
      await servedResponseOf(event);
      await settledWaitUntil(event);

      // No shard of the new build was cached (fetch phase failed first) and
      // the manifest is still build A.
      expect(cache.store.has(EN_SHARD)).toBe(false);
      expect(cache.store.has(DE_SHARD)).toBe(false);
      expect(cache.putOrder).toEqual([]);
      expect(await cache.store.get(INDEX_URL)?.text()).toBe(
        PREVIOUS_MANIFEST_BODY,
      );
    });

    it("a failed shard cache write leaves the previous manifest untouched", async () => {
      cache.store.set(INDEX_URL, new Response(PREVIOUS_MANIFEST_BODY));
      cache.putErrors.add(DE_SHARD);
      mockIndexFetch();

      const event = dispatch(requestFor("manifest.json"));
      await servedResponseOf(event);
      await settledWaitUntil(event);

      // EN may have been written before DE failed, but the manifest was not
      // committed (still build A) and DE was never committed.
      expect(cache.putOrder).toContain(EN_SHARD);
      expect(cache.store.has(DE_SHARD)).toBe(false);
      expect(cache.putOrder).not.toContain(INDEX_URL);
      expect(await cache.store.get(INDEX_URL)?.text()).toBe(
        PREVIOUS_MANIFEST_BODY,
      );
    });

    it("a failed manifest validation performs no commit at all", async () => {
      cache.store.set(INDEX_URL, new Response(PREVIOUS_MANIFEST_BODY));
      globalThis.fetch = mockIndexFetch({
        manifest: () => okJson({ version: 2, format: "json", languages: ["en"] }),
      });

      const event = dispatch(requestFor("manifest.json"));
      await servedResponseOf(event);
      await settledWaitUntil(event);

      expect(cache.putOrder).toEqual([]);
      expect(await cache.store.get(INDEX_URL)?.text()).toBe(
        PREVIOUS_MANIFEST_BODY,
      );
    });

    it("a non-OK manifest response performs no writes", async () => {
      cache.store.set(INDEX_URL, new Response(PREVIOUS_MANIFEST_BODY));
      globalThis.fetch = mockIndexFetch({
        manifest: () => new Response("no", { status: 500 }),
      });

      const event = dispatch(requestFor("manifest.json"));
      await servedResponseOf(event);
      await settledWaitUntil(event);

      expect(cache.putOrder).toEqual([]);
      expect(await cache.store.get(INDEX_URL)?.text()).toBe(
        PREVIOUS_MANIFEST_BODY,
      );
    });

    it("serves the complete atomic update when nothing is cached, and the committed response stays readable", async () => {
      mockIndexFetch();

      const event = dispatch(requestFor("manifest.json"));

      const served = await servedResponseOf(event);
      expect(await served.text()).toBe(JSON.stringify(MANIFEST));
      await settledWaitUntil(event);
      expect(cache.putOrder.at(-1)).toBe(INDEX_URL);
    });

    it("language-restricted refresh fetches only the selected language's shards", async () => {
      workerSelf.location.href =
        buildWorkerUrl("stale-while-revalidate") + "&languages=en";
      mockIndexFetch();

      const event = dispatch(requestFor("manifest.json"));
      await settledWaitUntil(event);

      const fetchedUrls = fetchMock.mock.calls.map(
        (call) => String(call[0]),
      );
      expect(fetchedUrls).toContain(INDEX_URL);
      expect(fetchedUrls).toContain(EN_SHARD);
      expect(fetchedUrls).toContain(DOCS_SHARD);
      expect(fetchedUrls).not.toContain(DE_SHARD);
      expect(cache.putOrder).toEqual([EN_SHARD, DOCS_SHARD, INDEX_URL]);
    });
  });

  it("cache-first behavior is unchanged: cached wins, a miss is fetched and not written", async () => {
    workerSelf.location.href = buildWorkerUrl("cache-first");
    cache.store.set(INDEX_URL, new Response("cached-old"));
    fetchMock.mockResolvedValue(new Response("network-new", { status: 200 }));

    const event = dispatch(requestFor("manifest.json"));
    expect(await (await servedResponseOf(event)).text()).toBe("cached-old");

    const miss = dispatch(requestFor("fresh.txt"));
    expect(await (await servedResponseOf(miss)).text()).toBe("network-new");
    expect(cache.store.has(`${INDEX_DIR}fresh.txt`)).toBe(false);
  });
});
