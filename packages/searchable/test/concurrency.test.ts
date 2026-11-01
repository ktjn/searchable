import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SearchClient } from "../src/client.js";
import type { PythonSourceDocument } from "../test-support/python-index.js";
import { writePythonIndex } from "../test-support/python-index.js";
import { serveStatic } from "./static-server.js";

/**
 * Concurrency characterization (system-spec Level 2/3 `req-concurrency`):
 * nothing else in the suite exercises many in-flight queries against one
 * shared SearchClient at once. A client is created once and reused across
 * a session -- the manifest fetch, shard cache and in-flight dedup all live
 * on that one instance -- so the real-world concurrency risk is many
 * overlapping `search()` calls on the *same* client, not multiple separate
 * clients. This builds one real index over real HTTP and fires many
 * distinct, non-overlapping-term queries at a single shared client at
 * once, asserting each gets back exactly its own result with no
 * cross-contamination from another query racing through the same shared
 * manifest-load/shard-cache state.
 */
const DOC_COUNT = 20;

function makeSources(): PythonSourceDocument[] {
  const sources: PythonSourceDocument[] = [];
  for (let id = 1; id <= DOC_COUNT; id++) {
    sources.push({
      id,
      url: `/doc-${id}`,
      html: `<html lang="en"><head><title>Doc ${id}</title></head>
        <body><main><p>widget uniqueterm${id}</p></main></body></html>`,
    });
  }
  return sources;
}

describe("concurrent queries against one shared SearchClient (real HTTP)", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let built: { outDir: string; cleanup: () => Promise<void> };

  beforeAll(async () => {
    built = await writePythonIndex(makeSources(), { defaultLanguage: "en" });
    const server = await serveStatic(built.outDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  afterAll(async () => {
    await closeServer();
    await built.cleanup();
  });

  it("many concurrent distinct-term queries on one client each return exactly their own hit, none cross-contaminated", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });

    // All DOC_COUNT queries race through the same not-yet-loaded manifest
    // and shard cache at once -- the sharpest version of this risk, since
    // every one of them has to share (not duplicate) that first load.
    const ids = Array.from({ length: DOC_COUNT }, (_, i) => i + 1);
    const results = await Promise.all(
      ids.map((id) => client.search(`uniqueterm${id}`)),
    );

    for (const [index, id] of ids.entries()) {
      const result = results[index];
      expect(result?.hits.map((h) => h.id)).toEqual([id]);
      expect(result?.hits[0]?.url).toBe(`/doc-${id}`);
    }
  });

  it("a broad query racing against many narrow queries on the same client still sees the full, correct result set", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const ids = Array.from({ length: DOC_COUNT }, (_, i) => i + 1);

    const [broad, ...narrow] = await Promise.all([
      client.search("widget", { limit: DOC_COUNT }),
      ...ids.map((id) => client.search(`uniqueterm${id}`)),
    ]);

    expect(broad.totalHits).toBe(DOC_COUNT);
    expect(broad.hits.map((h) => h.id).sort((a, b) => a - b)).toEqual(ids);
    for (const [index, id] of ids.entries()) {
      expect(narrow[index]?.hits.map((h) => h.id)).toEqual([id]);
    }
  });
});
