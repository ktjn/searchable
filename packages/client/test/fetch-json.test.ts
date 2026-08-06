import { afterEach, describe, expect, it, vi } from "vitest";
import { ShardCache } from "../src/fetch-json.js";

describe("ShardCache", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("caches a successful fetch and does not refetch on subsequent calls", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ a: 1 }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const cache = new ShardCache();
    await cache.fetchJson("https://example.com/a.json");
    await cache.fetchJson("https://example.com/a.json");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent in-flight requests for the same URL", async () => {
    let resolveFetch!: (value: unknown) => void;
    const fetchMock = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const cache = new ShardCache();
    const first = cache.fetchJson("https://example.com/a.json");
    const second = cache.fetchJson("https://example.com/a.json");
    resolveFetch({ ok: true, json: async () => ({ a: 1 }) });
    await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("evicts a failed fetch from the cache so a later call retries instead of replaying the same rejection forever", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ a: 1 }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const cache = new ShardCache();
    await expect(cache.fetchJson("https://example.com/a.json")).rejects.toThrow(
      /500/,
    );

    const result = await cache.fetchJson("https://example.com/a.json");
    expect(result).toEqual({ a: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("evicts a rejected fetch() call itself (network error), not just a non-ok response", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network error"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ a: 1 }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const cache = new ShardCache();
    await expect(cache.fetchJson("https://example.com/a.json")).rejects.toThrow(
      "network error",
    );

    const result = await cache.fetchJson("https://example.com/a.json");
    expect(result).toEqual({ a: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caches JSON and binary representations of the same URL separately, never colliding", async () => {
    const raw = new TextEncoder().encode("raw bytes");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ a: 1 }) })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => raw.buffer as ArrayBuffer,
      });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const cache = new ShardCache();
    const shared = "https://example.com/shared";
    const json = await cache.fetchJson<{ a: number }>(shared);
    const binary = await cache.fetchArrayBuffer(shared);

    expect(json).toEqual({ a: 1 });
    expect([...binary]).toEqual([...raw]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a failed JSON request for a URL does not poison a later binary request for the same URL", async () => {
    const raw = new TextEncoder().encode("raw bytes");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => raw.buffer as ArrayBuffer,
      });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const cache = new ShardCache();
    const shared = "https://example.com/shared";
    await expect(cache.fetchJson(shared)).rejects.toThrow(/500/);

    const binary = await cache.fetchArrayBuffer(shared);
    expect([...binary]).toEqual([...raw]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a failed binary request for a URL does not poison a later JSON request for the same URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ a: 1 }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const cache = new ShardCache();
    const shared = "https://example.com/shared";
    await expect(cache.fetchArrayBuffer(shared)).rejects.toThrow(/500/);

    const json = await cache.fetchJson<{ a: number }>(shared);
    expect(json).toEqual({ a: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
