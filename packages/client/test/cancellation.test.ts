import { describe, expect, it, vi } from "vitest";
import { SearchClient } from "../src/client.js";

const INDEX_URL = "https://example.com/index/manifest.json";

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

function makeDirectClient(): SearchClient {
  return new SearchClient({ indexUrl: INDEX_URL, worker: false });
}

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
