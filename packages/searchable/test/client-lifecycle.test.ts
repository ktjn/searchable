import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchClient } from "../src/client.js";

const INDEX_URL = "https://example.com/index/manifest.json";

const MANIFEST = {
  version: 2,
  buildId: "lifecycle-test",
  languages: ["en"],
  defaultLanguage: "en",
  fields: { title: { boost: 1, stored: true } },
  docCount: { en: 1 },
  avgFieldLength: { en: { title: 1 } },
  shards: {
    terms: [
      {
        lang: "en",
        prefix: "all",
        file: "terms.json",
        termCount: 1,
      },
    ],
    docs: [{ shard: 0, file: "docs.json", idRange: [1, 1] }],
    facets: [{ field: "category", file: "category.json" }],
  },
};

function jsonResponse(value: unknown): Response {
  return { ok: true, json: async () => value } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SearchClient lifecycle", () => {
  it("rejects every operation disposed while the manifest is loading", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const client = new SearchClient({ indexUrl: INDEX_URL });

    const ready = client.ready();
    const search = client.search("widget");
    const facets = client.facetValues("category");
    client.dispose();

    await Promise.all([
      expect(ready).rejects.toThrow("SearchClient disposed"),
      expect(search).rejects.toThrow("SearchClient disposed"),
      expect(facets).rejects.toThrow("SearchClient disposed"),
    ]);
  });

  it("rejects search and facet work disposed during shard loading", async () => {
    const fetchMock = vi.fn((url: string | URL | Request) => {
      if (String(url) === INDEX_URL) {
        return Promise.resolve(jsonResponse(MANIFEST));
      }
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new SearchClient({ indexUrl: INDEX_URL });
    await client.ready();

    const search = client.search("widget");
    const facets = client.facetValues("category");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    client.dispose();

    await Promise.all([
      expect(search).rejects.toThrow("SearchClient disposed"),
      expect(facets).rejects.toThrow("SearchClient disposed"),
      expect(client.ready()).rejects.toThrow("SearchClient disposed"),
    ]);
  });

  it("keeps dispose idempotent after rejecting the lifecycle promise", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const client = new SearchClient({ indexUrl: INDEX_URL });

    client.dispose();
    expect(() => client.dispose()).not.toThrow();
  });
});
