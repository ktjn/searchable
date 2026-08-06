import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lifecycle coverage for the offline Service Worker (sw.ts) run in plain
 * Node: a fake `self`/`caches`/`fetch` environment lets the `fetch` handler
 * be driven with a controllable Cache API, proving stale-while-revalidate
 * keeps `waitUntil()` pending until a successful cache write has persisted
 * (Phase 6) without poisoning the cache on failure.
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

  async match(request: Request | string): Promise<Response | undefined> {
    const url = typeof request === "string" ? request : request.url;
    const entry = this.store.get(url);
    return entry ? entry.clone() : undefined;
  }

  async put(request: Request | string, response: Response): Promise<void> {
    const url = typeof request === "string" ? request : request.url;
    if (this.putGate) await this.putGate;
    this.store.set(url, response.clone());
  }
}

const CACHE_NAME = "searchable-offline";
const INDEX_URL = "http://example.com/index/manifest.json";
const INDEX_DIR = "http://example.com/index/";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

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

  it("keeps waitUntil() pending until a successful cache.put() resolves, then caches the fresh body", async () => {
    cache.store.set(
      `${INDEX_DIR}manifest.json`,
      new Response('{"version":1}', { status: 200 }),
    );
    fetchMock.mockResolvedValue(
      new Response('{"version":1,"fresh":true}', { status: 200 }),
    );

    let releasePut!: () => void;
    cache.putGate = new Promise<void>((resolve) => {
      releasePut = resolve;
    });

    const event = dispatch(requestFor("manifest.json"));

    // The stale cached response is served right away...
    const served = await servedResponseOf(event);
    expect(await served.text()).toBe('{"version":1}');

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
    expect(await cache.store.get(`${INDEX_DIR}manifest.json`)?.text()).toBe(
      '{"version":1,"fresh":true}',
    );
  });

  it("serves the fresh network response and persists it when no cached entry exists", async () => {
    fetchMock.mockResolvedValue(new Response("fresh-only", { status: 200 }));

    const event = dispatch(requestFor("manifest.json"));

    const served = await servedResponseOf(event);
    expect(await served.text()).toBe("fresh-only");
    expect(await cache.store.get(`${INDEX_DIR}manifest.json`)?.text()).toBe(
      "fresh-only",
    );
  });

  it("a failed network request stalls the refresh but never replaces the cached entry", async () => {
    cache.store.set(
      `${INDEX_DIR}manifest.json`,
      new Response("cached-good", { status: 200 }),
    );
    fetchMock.mockRejectedValue(new TypeError("network down"));

    const event = dispatch(requestFor("manifest.json"));

    const served = await servedResponseOf(event);
    expect(await served.text()).toBe("cached-good");
    await flush();
    expect(await cache.store.get(`${INDEX_DIR}manifest.json`)?.text()).toBe(
      "cached-good",
    );
  });

  it("returns a non-OK network response when nothing is cached, without caching it", async () => {
    fetchMock.mockResolvedValue(new Response("not found", { status: 404 }));

    const event = dispatch(requestFor("missing.txt"));

    const served = await servedResponseOf(event);
    expect(served.status).toBe(404);
    expect(await served.text()).toBe("not found");
    expect(cache.store.has(`${INDEX_DIR}missing.txt`)).toBe(false);
  });

  it("a non-OK refresh does not replace an existing good cached response", async () => {
    cache.store.set(
      `${INDEX_DIR}manifest.json`,
      new Response("cached-good", { status: 200 }),
    );
    fetchMock.mockResolvedValue(new Response("server error", { status: 500 }));

    const event = dispatch(requestFor("manifest.json"));

    const served = await servedResponseOf(event);
    expect(await served.text()).toBe("cached-good");
    expect(await cache.store.get(`${INDEX_DIR}manifest.json`)?.text()).toBe(
      "cached-good",
    );
  });

  it("cache-first behavior is unchanged: cached wins, a miss is fetched and not written", async () => {
    workerSelf.location.href = buildWorkerUrl("cache-first");
    cache.store.set(
      `${INDEX_DIR}manifest.json`,
      new Response("cached-old", { status: 200 }),
    );
    fetchMock.mockResolvedValue(new Response("network-new", { status: 200 }));

    const event = dispatch(requestFor("manifest.json"));
    expect(await (await servedResponseOf(event)).text()).toBe("cached-old");

    const miss = dispatch(requestFor("fresh.txt"));
    expect(await (await servedResponseOf(miss)).text()).toBe("network-new");
    expect(cache.store.has(`${INDEX_DIR}fresh.txt`)).toBe(false);
  });
});
