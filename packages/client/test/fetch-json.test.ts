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
});
