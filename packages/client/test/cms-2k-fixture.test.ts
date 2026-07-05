import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateCms2kCorpus } from "@csf/fixtures";
import { buildIndex, writeIndex } from "@csf/indexer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SearchClient } from "../src/client.js";
import { serveStatic } from "./static-server.js";

/**
 * The Phase 0 fixture end-to-end pass (docs/09-roadmap.md#status,
 * docs/14-reference-deployment-cms-2k.md): a realistically-shaped,
 * moderate-scale corpus rather than the handful of one-off sentences
 * the rest of this file uses -- a shard built from a few hundred real
 * paragraphs across two languages is a meaningfully different fetch/
 * parse/score workload than three tiny inline docs, and this is the
 * one suite that actually exercises that.
 */
describe("CMS-2k reference fixture (real HTTP, realistic scale)", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let outDir: string;

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "csf-cms-2k-"));
    const sources = generateCms2kCorpus({ count: 400 });
    const built = buildIndex(sources);
    await writeIndex(built, outDir);
    const server = await serveStatic(outDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  afterAll(async () => {
    await closeServer();
    await rm(outDir, { recursive: true, force: true });
  });

  it("finds real documents for a real term drawn from the fixture's own prose", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits, totalHits } = await client.search("sharding");
    expect(totalHits).toBeGreaterThan(0);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.score).toBeGreaterThan(0);
  });

  it("facet-filters by category and every returned hit actually belongs to it", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits, facets } = await client.search("the", {
      filters: { category: "Engineering" },
      facets: ["category"],
      limit: 200, // comfortably above the fixture's ~50 English Engineering docs, so no display-limit truncation skews the count-vs-hits comparison below
    });
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.url).toContain("/engineering/");
    }
    const engineeringCount = facets?.category?.values.find(
      (v) => v.value === "Engineering",
    )?.count;
    expect(engineeringCount).toBe(hits.length);
  });

  it("a high-intent marketing query is pinned above organic results", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("pricing");
    expect(hits[0]?.pinned).toBe(true);
    expect(hits[0]?.url).toBe("/en/pricing.html");
  });

  it("partitions organic results by language even at this scale", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    // "postmortems" only ever appears in the English paragraph bank --
    // the German equivalent paragraph uses "Nachbesprechungen" instead,
    // unlike some other technical terms in this fixture (e.g.
    // "Sharding," "Worker") which are common German loanwords too and
    // so wouldn't actually prove language exclusivity.
    const en = await client.search("postmortems", { language: "en" });
    expect(en.hits.length).toBeGreaterThan(0);
    const de = await client.search("postmortems", { language: "de" });
    expect(de.hits.length).toBe(0);
  });
});
