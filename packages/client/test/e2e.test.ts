import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndex, writeIndex } from "@csf/indexer";
import type { SourceDocument } from "@csf/indexer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SearchClient } from "../src/client.js";
import { serveStatic } from "./static-server.js";

const sources: SourceDocument[] = [
  {
    id: 1,
    url: "/widgets",
    html: `<html lang="en"><head><title>Widgets</title>
      <meta name="description" content="Everything you need to know about widgets."></head>
      <body><main><p>Our widgets are wonderful. Buy widgets today.</p></main></body></html>`,
  },
  {
    id: 2,
    url: "/gadgets",
    html: `<html lang="en"><head><title>Gadgets</title></head>
      <body><main><p>Gadgets and gizmos, plus a few widgets for good measure.</p></main></body></html>`,
  },
  {
    id: 3,
    url: "/about",
    html: `<html lang="en"><head><title>About Us</title></head>
      <body><main><p>We are a small company that makes things.</p></main></body></html>`,
  },
  {
    id: 4,
    url: "/draft",
    html: `<html lang="en"><head><title>Widgets Draft</title><meta name="csf-noindex"></head>
      <body><main><p>widgets widgets widgets</p></main></body></html>`,
  },
];

describe("indexer -> client end to end (over real HTTP)", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let outDir: string;

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "csf-e2e-"));
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

  it("fetches the manifest and returns ranked, relevant hits", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("widgets");

    expect(hits.map((h) => h.id)).toEqual([1, 2]); // 3/about never mentions widgets
    expect(hits[0]?.url).toBe("/widgets");
    expect(hits[0]?.fields.title).toBe("Widgets");
    expect((hits[0]?.score ?? 0) > (hits[1]?.score ?? 0)).toBe(true);
  });

  it("excludes csf-noindex documents from being findable at all", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("widgets");
    expect(hits.some((h) => h.url === "/draft")).toBe(false);
  });

  it("boolean-ANDs multiple query terms", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("gadgets gizmos");
    expect(hits.map((h) => h.id)).toEqual([2]);
  });

  it("returns no results when a query term matches nothing", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    expect((await client.search("nonexistentterm")).hits).toEqual([]);
  });

  it("uses the derived excerpt when no meta description was given", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("company");
    expect(hits[0]?.fields.excerpt).toContain("small company");
  });

  it("prefers the explicit meta description as the excerpt when present", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("widgets");
    expect(hits[0]?.fields.excerpt).toBe(
      "Everything you need to know about widgets.",
    );
  });
});

describe("observability hooks (client.on)", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let outDir: string;

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "csf-e2e-observability-"));
    await writeIndex(buildIndex(sources), outDir);
    const server = await serveStatic(outDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  afterAll(async () => {
    await closeServer();
    await rm(outDir, { recursive: true, force: true });
  });

  it("fires 'query' before 'result', each with the right payload", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const events: string[] = [];
    let queryPayload: unknown;
    let resultPayload: unknown;
    client.on("query", (payload) => {
      events.push("query");
      queryPayload = payload;
    });
    client.on("result", (payload) => {
      events.push("result");
      resultPayload = payload;
    });

    const result = await client.search("widgets", { limit: 5 });

    expect(events).toEqual(["query", "result"]);
    expect(queryPayload).toEqual({ query: "widgets", options: { limit: 5 } });
    expect(resultPayload).toEqual({
      query: "widgets",
      options: { limit: 5 },
      result,
    });
  });

  it("supports multiple independent listeners for the same event", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    let firstCalls = 0;
    let secondCalls = 0;
    client.on("query", () => {
      firstCalls++;
    });
    client.on("query", () => {
      secondCalls++;
    });

    await client.search("widgets");

    expect(firstCalls).toBe(1);
    expect(secondCalls).toBe(1);
  });

  it("stops firing once the unsubscribe function returned by on() is called", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    let calls = 0;
    const unsubscribe = client.on("query", () => {
      calls++;
    });

    await client.search("widgets");
    unsubscribe();
    await client.search("widgets");

    expect(calls).toBe(1);
  });

  it("a listener that throws does not break the search() call it's observing", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    client.on("query", () => {
      throw new Error("broken analytics integration");
    });

    const { hits } = await client.search("widgets");
    expect(hits.map((h) => h.id)).toEqual([1, 2]);
  });
});

describe("SearchClient.dispose() in main-thread mode", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let outDir: string;

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "csf-e2e-dispose-"));
    await writeIndex(buildIndex(sources), outDir);
    const server = await serveStatic(outDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  afterAll(async () => {
    await closeServer();
    await rm(outDir, { recursive: true, force: true });
  });

  it("is idempotent -- calling it more than once does not throw", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    await client.ready();
    client.dispose();
    expect(() => client.dispose()).not.toThrow();
  });

  it("rejects search() after dispose(), even without a worker", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    await client.ready();
    client.dispose();
    await expect(client.search("widgets")).rejects.toThrow(/disposed/);
  });
});

describe("manifest validation (real HTTP)", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let outDir: string;

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "csf-e2e-validate-"));
    const server = await serveStatic(outDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  afterAll(async () => {
    await closeServer();
    await rm(outDir, { recursive: true, force: true });
  });

  it("rejects a structurally invalid manifest instead of failing deep in search()", async () => {
    await writeFile(
      join(outDir, "bad-manifest.json"),
      JSON.stringify({ version: 2, format: "json" }),
      "utf8",
    );
    const client = new SearchClient({
      indexUrl: `${baseUrl}bad-manifest.json`,
    });
    await expect(client.ready()).rejects.toThrow(/invalid manifest/);
  });

  it("rejects a manifest whose shard file resolves cross-origin by default", async () => {
    const built = buildIndex(sources);
    await writeIndex(built, outDir);
    const manifestPath = join(outDir, "manifest.json");
    const { readFile } = await import("node:fs/promises");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.shards.terms[0].file =
      "https://evil.example.com/terms/en/all.json";
    await writeFile(
      join(outDir, "cross-origin-manifest.json"),
      JSON.stringify(manifest),
      "utf8",
    );

    const client = new SearchClient({
      indexUrl: `${baseUrl}cross-origin-manifest.json`,
    });
    await expect(client.ready()).rejects.toThrow(/different origin/);
  });
});

describe("document-level boost (csf-boost)", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let outDir: string;

  const boostSources: SourceDocument[] = [
    {
      id: 1,
      url: "/widgets",
      html: `<html lang="en"><head><title>Widgets</title></head>
        <body><main><p>Buy widgets today.</p></main></body></html>`,
    },
    {
      id: 2,
      url: "/clearance",
      html: `<html lang="en"><head><title>Clearance Sale</title>
        <meta name="csf-boost" content="50"></head>
        <body><main><p>Clearance widgets, while supplies last.</p></main></body></html>`,
    },
  ];

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "csf-e2e-boost-"));
    await writeIndex(buildIndex(boostSources), outDir);
    const server = await serveStatic(outDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  afterAll(async () => {
    await closeServer();
    await rm(outDir, { recursive: true, force: true });
  });

  it("lets a heavily boosted, otherwise-lower-relevance doc outrank a title match", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("widgets");
    expect(hits.map((h) => h.id)).toEqual([2, 1]);
  });
});

describe("per-query field boost override", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let outDir: string;

  const fieldBoostSources: SourceDocument[] = [
    {
      id: 1,
      url: "/a",
      html: `<html lang="en"><head><title>Widgets</title></head>
        <body><main><p>Unrelated padding content here.</p></main></body></html>`,
    },
    {
      id: 2,
      url: "/b",
      html: `<html lang="en"><head><title>Other Page</title></head>
        <body><main><p>widgets widgets widgets widgets widgets</p></main></body></html>`,
    },
  ];

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "csf-e2e-fieldboost-"));
    await writeIndex(buildIndex(fieldBoostSources), outDir);
    const server = await serveStatic(outDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  afterAll(async () => {
    await closeServer();
    await rm(outDir, { recursive: true, force: true });
  });

  it("ranks the 5x body match first under default field boosts", async () => {
    // doc 1 matches once via a 3x-boosted title; doc 2 matches 5 times in
    // an unboosted body — BM25's saturation curve means raw occurrence
    // count still wins here despite the title boost, empirically.
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("widgets");
    expect(hits[0]?.id).toBe(2);
  });

  it("flips the ranking when the query overrides title far above body", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("widgets", {
      boosts: { fields: { title: 100, body: 0.01 } },
    });
    expect(hits[0]?.id).toBe(1);
  });
});

describe("per-query term boost", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let outDir: string;

  // Symmetric fixture: doc 1 has more "apple", doc 2 has more "banana" -
  // both match both terms, so under default (no term boost) weighting
  // they should score identically by symmetry.
  const termBoostSources: SourceDocument[] = [
    {
      id: 1,
      url: "/a",
      html: `<html lang="en"><head><title>Page A</title></head>
        <body><main><p>apple apple apple banana</p></main></body></html>`,
    },
    {
      id: 2,
      url: "/b",
      html: `<html lang="en"><head><title>Page B</title></head>
        <body><main><p>apple banana banana banana</p></main></body></html>`,
    },
  ];

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "csf-e2e-termboost-"));
    await writeIndex(buildIndex(termBoostSources), outDir);
    const server = await serveStatic(outDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  afterAll(async () => {
    await closeServer();
    await rm(outDir, { recursive: true, force: true });
  });

  it("scores symmetric documents equally with no term boost", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("apple banana");
    expect(hits[0]?.score).toBeCloseTo(hits[1]?.score ?? Number.NaN);
  });

  it("boosting a term tips the tie toward the doc with more of that term", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("apple banana", {
      boosts: { terms: { apple: 20 } },
    });
    expect(hits[0]?.id).toBe(1); // doc 1 has 3x "apple", benefits most
  });
});

describe("prefix matching (term*)", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let outDir: string;

  const prefixSources: SourceDocument[] = [
    {
      id: 1,
      url: "/widget",
      html: `<html lang="en"><head><title>Widget</title></head>
        <body><main><p>A single widget for sale.</p></main></body></html>`,
    },
    {
      id: 2,
      url: "/widgets",
      html: `<html lang="en"><head><title>Widgets</title></head>
        <body><main><p>Buy widgets in bulk.</p></main></body></html>`,
    },
    {
      id: 3,
      url: "/widgetry",
      html: `<html lang="en"><head><title>Widgetry</title></head>
        <body><main><p>The fine art of widgetry.</p></main></body></html>`,
    },
    {
      id: 4,
      url: "/gadgets",
      html: `<html lang="en"><head><title>Gadgets</title></head>
        <body><main><p>Gadgets and gizmos only.</p></main></body></html>`,
    },
  ];

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "csf-e2e-prefix-"));
    await writeIndex(buildIndex(prefixSources), outDir);
    const server = await serveStatic(outDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  afterAll(async () => {
    await closeServer();
    await rm(outDir, { recursive: true, force: true });
  });

  it("matches every real term sharing the prefix, not just an exact term", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("widg*");
    expect(hits.map((h) => h.id).sort()).toEqual([1, 2, 3]);
  });

  it("does not match documents outside the prefix", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("widg*");
    expect(hits.some((h) => h.id === 4)).toBe(false);
  });

  it("still ANDs a prefix clause against other exact clauses", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("widg* bulk");
    expect(hits.map((h) => h.id)).toEqual([2]);
  });

  it("returns no results when a prefix matches no real term", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    expect((await client.search("zzz*")).hits).toEqual([]);
  });

  it("falls back to an exact match when there's no trailing *", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("widget");
    expect(hits.map((h) => h.id)).toEqual([1]); // not 2 or 3
  });
});

describe("facet filtering and contextual counts", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let outDir: string;

  // All three organically match "durable widget"; category/brand facets
  // split them so filtering/counting behavior is unambiguous.
  const facetSources: SourceDocument[] = [
    {
      id: 1,
      url: "/a",
      html: `<html lang="en"><head><title>Widget A</title>
        <meta name="csf-facet-category" content="electronics">
        <meta name="csf-facet-brand" content="acme"></head>
        <body><main><p>A durable widget.</p></main></body></html>`,
    },
    {
      id: 2,
      url: "/b",
      html: `<html lang="en"><head><title>Widget B</title>
        <meta name="csf-facet-category" content="electronics">
        <meta name="csf-facet-brand" content="globex"></head>
        <body><main><p>A durable widget.</p></main></body></html>`,
    },
    {
      id: 3,
      url: "/c",
      html: `<html lang="en"><head><title>Widget C</title>
        <meta name="csf-facet-category" content="books"></head>
        <body><main><p>A durable widget.</p></main></body></html>`,
    },
  ];

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "csf-e2e-facets-"));
    await writeIndex(buildIndex(facetSources), outDir);
    const server = await serveStatic(outDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  afterAll(async () => {
    await closeServer();
    await rm(outDir, { recursive: true, force: true });
  });

  it("intersects results with a single-value filter", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("durable widget", {
      filters: { category: "electronics" },
    });
    expect(hits.map((h) => h.id).sort()).toEqual([1, 2]);
  });

  it("unions multiple values within one filter field (OR)", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("durable widget", {
      filters: { brand: ["acme", "globex"] },
    });
    expect(hits.map((h) => h.id).sort()).toEqual([1, 2]);
  });

  it("intersects across different filter fields (AND)", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("durable widget", {
      filters: { category: "electronics", brand: "acme" },
    });
    expect(hits.map((h) => h.id)).toEqual([1]);
  });

  it("ignores a filter field with no matching facet shard", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("durable widget", {
      filters: { nonexistentField: "whatever" },
    });
    expect(hits.map((h) => h.id).sort()).toEqual([1, 2, 3]);
  });

  it("reports global (unfiltered) facet values and counts", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { facets } = await client.search("durable widget", {
      facets: ["category"],
    });
    const values = facets?.category?.values.sort((a, b) =>
      a.value.localeCompare(b.value),
    );
    expect(values).toEqual([
      { value: "books", count: 1, selected: false },
      { value: "electronics", count: 2, selected: false },
    ]);
  });

  it("computes contextual counts against other active filters, but not a facet's own", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits, facets } = await client.search("durable widget", {
      filters: { brand: "acme" },
      facets: ["category", "brand"],
    });

    // Results are narrowed by the active brand filter.
    expect(hits.map((h) => h.id)).toEqual([1]);

    // The brand facet excludes its OWN active filter from the base set,
    // so the unselected value ("globex") still shows its real count
    // instead of being zeroed out by the very filter that selects "acme".
    const brandValues = facets?.brand?.values.sort((a, b) =>
      a.value.localeCompare(b.value),
    );
    expect(brandValues).toEqual([
      { value: "acme", count: 1, selected: true },
      { value: "globex", count: 1, selected: false },
    ]);

    // The category facet is a different field, so it DOES reflect the
    // active brand filter (contextual, not global, counts).
    const categoryValues = facets?.category?.values.sort((a, b) =>
      a.value.localeCompare(b.value),
    );
    expect(categoryValues).toEqual([
      { value: "books", count: 0, selected: false },
      { value: "electronics", count: 1, selected: false },
    ]);
  });
});

describe("facetValues() -- filter-only facet queries with no free-text search", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let outDir: string;

  // Same shape as the "facet filtering and contextual counts" fixture above,
  // duplicated (not shared) so this describe block stays self-contained --
  // category/brand split the docs so global vs. contextual counts are
  // unambiguous even with no organic query narrowing the candidate set.
  const facetSources: SourceDocument[] = [
    {
      id: 1,
      url: "/a",
      html: `<html lang="en"><head><title>Widget A</title>
        <meta name="csf-facet-category" content="electronics">
        <meta name="csf-facet-brand" content="acme">
        <meta name="csf-facet-range-price" content="10"></head>
        <body><main><p>A durable widget.</p></main></body></html>`,
    },
    {
      id: 2,
      url: "/b",
      html: `<html lang="en"><head><title>Widget B</title>
        <meta name="csf-facet-category" content="electronics">
        <meta name="csf-facet-brand" content="globex">
        <meta name="csf-facet-range-price" content="20"></head>
        <body><main><p>A durable widget.</p></main></body></html>`,
    },
    {
      id: 3,
      url: "/c",
      html: `<html lang="en"><head><title>Widget C</title>
        <meta name="csf-facet-category" content="books"></head>
        <body><main><p>A durable widget.</p></main></body></html>`,
    },
  ];

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "csf-e2e-facet-values-"));
    await writeIndex(buildIndex(facetSources), outDir);
    const server = await serveStatic(outDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  afterAll(async () => {
    await closeServer();
    await rm(outDir, { recursive: true, force: true });
  });

  it("reports global counts over the whole corpus with no filters at all", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { values } = await client.facetValues("category");
    expect(values.sort((a, b) => a.value.localeCompare(b.value))).toEqual([
      { value: "books", count: 1, selected: false },
      { value: "electronics", count: 2, selected: false },
    ]);
  });

  it("narrows counts by another active filter field, but not the field's own", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { values } = await client.facetValues("category", {
      filters: { brand: "acme" },
    });
    expect(values.sort((a, b) => a.value.localeCompare(b.value))).toEqual([
      { value: "books", count: 0, selected: false },
      { value: "electronics", count: 1, selected: false },
    ]);
  });

  it("marks the currently-selected value(s) for the field itself without narrowing its own counts", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { values } = await client.facetValues("brand", {
      filters: { brand: "acme" },
    });
    expect(values.sort((a, b) => a.value.localeCompare(b.value))).toEqual([
      { value: "acme", count: 1, selected: true },
      { value: "globex", count: 1, selected: false },
    ]);
  });

  it("returns an empty values array for an unknown facet field", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { values } = await client.facetValues("nonexistentField");
    expect(values).toEqual([]);
  });

  it("returns an empty values array for a range-type facet field (aggregate range results not yet implemented)", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { values } = await client.facetValues("price");
    expect(values).toEqual([]);
  });
});

describe("range facet filtering", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let outDir: string;

  // All four organically match "widget"; price is a range facet
  // (csf-facet-range-price) so min/max filtering is unambiguous.
  const rangeSources: SourceDocument[] = [
    {
      id: 1,
      url: "/cheap",
      html: `<html lang="en"><head><title>Cheap Widget</title>
        <meta name="csf-facet-range-price" content="9.99"></head>
        <body><main><p>An affordable widget.</p></main></body></html>`,
    },
    {
      id: 2,
      url: "/mid",
      html: `<html lang="en"><head><title>Midrange Widget</title>
        <meta name="csf-facet-range-price" content="49.5"></head>
        <body><main><p>A midrange widget.</p></main></body></html>`,
    },
    {
      id: 3,
      url: "/premium",
      html: `<html lang="en"><head><title>Premium Widget</title>
        <meta name="csf-facet-range-price" content="199"></head>
        <body><main><p>A premium widget.</p></main></body></html>`,
    },
    {
      id: 4,
      url: "/no-price",
      html: `<html lang="en"><head><title>Undated Widget</title></head>
        <body><main><p>A widget with no listed price.</p></main></body></html>`,
    },
  ];

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "csf-e2e-range-facets-"));
    await writeIndex(buildIndex(rangeSources), outDir);
    const server = await serveStatic(outDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  afterAll(async () => {
    await closeServer();
    await rm(outDir, { recursive: true, force: true });
  });

  it("filters to an inclusive [min, max] range", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("widget", {
      filters: { price: { min: 10, max: 100 } },
    });
    expect(hits.map((h) => h.id)).toEqual([2]);
  });

  it("supports an open-ended minimum (no max)", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("widget", {
      filters: { price: { min: 50 } },
    });
    expect(hits.map((h) => h.id).sort()).toEqual([3]);
  });

  it("supports an open-ended maximum (no min)", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("widget", {
      filters: { price: { max: 10 } },
    });
    expect(hits.map((h) => h.id)).toEqual([1]);
  });

  it("includes exact boundary values (inclusive bounds)", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("widget", {
      filters: { price: { min: 49.5, max: 49.5 } },
    });
    expect(hits.map((h) => h.id)).toEqual([2]);
  });

  it("excludes documents with no declared value for the range field", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("widget", {
      filters: { price: { min: 0 } },
    });
    expect(hits.map((h) => h.id)).not.toContain(4);
  });

  it("combines a range filter with organic scoring (still ranked by relevance)", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { totalHits } = await client.search("widget", {
      filters: { price: { min: 0, max: 1000 } },
    });
    expect(totalHits).toBe(3); // every priced widget, excluding the unpriced one
  });
});

describe("term-to-page pinning (csf-pin)", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let outDir: string;

  const pinSources: SourceDocument[] = [
    {
      id: 1,
      url: "/pricing",
      html: `<html lang="en"><head><title>Enterprise Plans</title>
        <meta name="csf-pin" content="pricing"></head>
        <body><main><p>Our enterprise plans are flexible.</p></main></body></html>`,
    },
    {
      id: 2,
      url: "/budget",
      html: `<html lang="en"><head><title>Budget Guide</title></head>
        <body><main><p>How to save money.</p></main></body></html>`,
    },
    {
      id: 3,
      url: "/faq",
      html: `<html lang="en"><head><title>FAQ</title>
        <meta name="csf-pin" content="cost">
        <meta name="csf-pin-mode" content="contains"></head>
        <body><main><p>Answers to common questions about cost and pricing.</p></main></body></html>`,
    },
  ];

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "csf-e2e-pins-"));
    await writeIndex(buildIndex(pinSources), outDir);
    const server = await serveStatic(outDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  afterAll(async () => {
    await closeServer();
    await rm(outDir, { recursive: true, force: true });
  });

  it("places an exact-mode pin first, marked pinned:true, above organic matches", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("pricing");
    // doc 1 only via its pin (its own text never says "pricing"); doc 3
    // matches organically too, since its body literally contains "pricing".
    expect(hits.map((h) => ({ id: h.id, pinned: h.pinned ?? false }))).toEqual([
      { id: 1, pinned: true },
      { id: 3, pinned: false },
    ]);
  });

  it("requires the whole query to equal the phrase under the default exact mode", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("enterprise pricing plans");
    expect(hits.some((h) => h.id === 1 && h.pinned)).toBe(false);
  });

  it("matches a contains-mode pin as a subsequence of a longer query", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("total cost estimate");
    expect(hits[0]).toMatchObject({ id: 3, pinned: true });
  });
});

describe("term-to-page pinning: conflicts and exclusivity", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let outDir: string;

  const conflictSources: SourceDocument[] = [
    {
      id: 1,
      url: "/vip-a",
      html: `<html lang="en"><head><title>VIP A</title>
        <meta name="csf-pin" content="vip">
        <meta name="csf-pin-priority" content="1"></head>
        <body><main><p>A vip page.</p></main></body></html>`,
    },
    {
      id: 2,
      url: "/vip-b",
      html: `<html lang="en"><head><title>VIP B</title>
        <meta name="csf-pin" content="vip">
        <meta name="csf-pin-priority" content="10">
        <meta name="csf-pin-exclusive"></head>
        <body><main><p>Another vip page.</p></main></body></html>`,
    },
    {
      id: 3,
      url: "/other",
      html: `<html lang="en"><head><title>Other</title></head>
        <body><main><p>This page also mentions vip in passing.</p></main></body></html>`,
    },
  ];

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "csf-e2e-pin-conflict-"));
    await writeIndex(buildIndex(conflictSources), outDir);
    const server = await serveStatic(outDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  afterAll(async () => {
    await closeServer();
    await rm(outDir, { recursive: true, force: true });
  });

  it("orders conflicting pins by priority and suppresses organic results once any is exclusive", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("vip");
    expect(hits).toEqual([
      expect.objectContaining({ id: 2, pinned: true }),
      expect.objectContaining({ id: 1, pinned: true }),
    ]);
    expect(hits.some((h) => h.id === 3)).toBe(false); // organic match suppressed
  });
});

describe("term-to-page pinning: facet-filter interaction", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let outDir: string;

  const pinFilterSources: SourceDocument[] = [
    {
      id: 1,
      url: "/pin-target",
      html: `<html lang="en"><head><title>Widget</title>
        <meta name="csf-pin" content="featured">
        <meta name="csf-facet-category" content="electronics"></head>
        <body><main><p>Standard product listing.</p></main></body></html>`,
    },
    {
      id: 2,
      url: "/other-book",
      html: `<html lang="en"><head><title>Book</title>
        <meta name="csf-facet-category" content="books"></head>
        <body><main><p>An unrelated book.</p></main></body></html>`,
    },
  ];

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "csf-e2e-pin-filter-"));
    await writeIndex(buildIndex(pinFilterSources), outDir);
    const server = await serveStatic(outDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  afterAll(async () => {
    await closeServer();
    await rm(outDir, { recursive: true, force: true });
  });

  it("shows a pin with no active filters", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("featured");
    expect(hits).toEqual([expect.objectContaining({ id: 1, pinned: true })]);
  });

  it("hides a pin excluded by an active filter the user explicitly set", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("featured", {
      filters: { category: "books" },
    });
    expect(hits).toEqual([]);
  });
});

describe("multi-language corpora", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let outDir: string;

  const multiLangSources: SourceDocument[] = [
    {
      id: 1,
      url: "/en/widgets",
      html: `<html lang="en"><head><title>Widgets</title></head>
        <body><main><p>We sell wonderful widgets.</p></main></body></html>`,
    },
    {
      id: 2,
      url: "/de/preise",
      html: `<html lang="de"><head><title>Preise</title></head>
        <body><main><p>Unsere Preise sind einfach und fair.</p></main></body></html>`,
    },
  ];

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "csf-e2e-i18n-"));
    await writeIndex(buildIndex(multiLangSources), outDir);
    const server = await serveStatic(outDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  afterAll(async () => {
    await closeServer();
    await rm(outDir, { recursive: true, force: true });
  });

  it("searches the default language's partition when no language is given", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("widgets");
    expect(hits.map((h) => h.id)).toEqual([1]);
  });

  it("searches a different language's partition when asked", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("preise", { language: "de" });
    expect(hits.map((h) => h.id)).toEqual([2]);
  });

  it("never cross-matches a term against the wrong language's partition", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    expect((await client.search("widgets", { language: "de" })).hits).toEqual(
      [],
    );
    expect((await client.search("preise", { language: "en" })).hits).toEqual(
      [],
    );
  });
});

describe("synonym expansion (csf synonyms)", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let outDir: string;

  const synonymSources: SourceDocument[] = [
    {
      id: 1,
      url: "/couch",
      html: `<html lang="en"><head><title>Couch Selection</title></head>
        <body><main><p>Our couch selection is huge.</p></main></body></html>`,
    },
    {
      id: 2,
      url: "/sofa-brand",
      html: `<html lang="en"><head><title>Brand X Sofa</title></head>
        <body><main><p>The Brand X sofa is elegant.</p></main></body></html>`,
    },
    {
      id: 3,
      url: "/notebook",
      html: `<html lang="en"><head><title>Notebook Reviews</title></head>
        <body><main><p>Notebook reviews and comparisons.</p></main></body></html>`,
    },
    {
      id: 4,
      url: "/laptop",
      html: `<html lang="en"><head><title>Laptop Deals</title></head>
        <body><main><p>Laptop deals this week.</p></main></body></html>`,
    },
  ];

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "csf-e2e-synonyms-"));
    const built = buildIndex(synonymSources, "en", {
      synonyms: {
        en: {
          equivalences: [["sofa", "couch"]],
          directional: { laptop: ["notebook"] },
        },
      },
    });
    await writeIndex(built, outDir);
    const server = await serveStatic(outDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  afterAll(async () => {
    await closeServer();
    await rm(outDir, { recursive: true, force: true });
  });

  it("does not expand synonyms by default", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("sofa");
    expect(hits.map((h) => h.id)).toEqual([2]); // only the literal "sofa" doc
  });

  it("expands an equivalence class when synonyms:true, ranking the literal match above the synonym match", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("sofa", { synonyms: true });
    expect(hits.map((h) => h.id)).toEqual([2, 1]); // literal "sofa" (id 2) outranks synonym-matched "couch" (id 1)
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? Number.NaN);
  });

  it("is symmetric for equivalence classes: searching the other member also cross-matches", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("couch", { synonyms: true });
    expect(hits.map((h) => h.id).sort()).toEqual([1, 2]);
  });

  it("expands a directional synonym forward but not backward", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const forward = await client.search("laptop", { synonyms: true });
    expect(forward.hits.map((h) => h.id).sort()).toEqual([3, 4]); // laptop -> also matches notebook doc

    const backward = await client.search("notebook", { synonyms: true });
    expect(backward.hits.map((h) => h.id)).toEqual([3]); // notebook does NOT expand back to laptop
  });

  it("respects a custom synonymWeight", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("sofa", {
      synonyms: true,
      synonymWeight: 0.01,
    });
    // Still finds both, but the synonym match's score drops much closer to zero.
    expect(hits.map((h) => h.id)).toEqual([2, 1]);
    expect(hits[1]?.score).toBeLessThan(0.1);
  });
});

describe("fuzzy matching (SymSpell deletion dictionary)", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let outDir: string;

  const fuzzySources: SourceDocument[] = [
    {
      id: 1,
      url: "/widget",
      html: `<html lang="en"><head><title>Widget Page</title></head>
        <body><main><p>All about the widget.</p></main></body></html>`,
    },
    {
      id: 2,
      url: "/widgit-literal",
      html: `<html lang="en"><head><title>Widgit Literal</title></head>
        <body><main><p>This page literally says widgit, on purpose.</p></main></body></html>`,
    },
    {
      id: 3,
      url: "/unrelated",
      html: `<html lang="en"><head><title>Unrelated</title></head>
        <body><main><p>Nothing to do with any of that.</p></main></body></html>`,
    },
  ];

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "csf-e2e-fuzzy-"));
    const built = buildIndex(fuzzySources, "en", { fuzzy: true });
    await writeIndex(built, outDir);
    const server = await serveStatic(outDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  afterAll(async () => {
    await closeServer();
    await rm(outDir, { recursive: true, force: true });
  });

  it("does not fuzzy-match a typo by default", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("widgit"); // typo of "widget", true edit distance 1
    expect(hits.map((h) => h.id)).toEqual([2]); // only the literal "widgit" doc
  });

  it("fuzzy:true finds a true distance-1 typo, ranked below a literal match", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("widgit", { fuzzy: true });
    expect(hits.map((h) => h.id)).toEqual([2, 1]); // literal "widgit" (id 2) outranks fuzzy-matched "widget" (id 1)
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? Number.NaN);
  });

  it("respects a custom fuzzyWeight", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("widgit", {
      fuzzy: true,
      fuzzyWeight: 0.01,
    });
    expect(hits.map((h) => h.id)).toEqual([2, 1]);
    expect(hits[1]?.score).toBeLessThan(0.1);
  });

  it("does not fuzzy-match a true distance-2 typo (beyond maxEdits:1), but surfaces it via didYouMean", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    // "wigdet" is an adjacent-character transposition of "widget" (true edit distance 2).
    const { hits, didYouMean } = await client.search("wigdet", { fuzzy: true });
    expect(hits).toEqual([]);
    expect(didYouMean).toContain("widget");
  });

  it("omits didYouMean when fuzzy is not enabled", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits, didYouMean } = await client.search("wigdet");
    expect(hits).toEqual([]);
    expect(didYouMean).toBeUndefined();
  });

  it("omits didYouMean when the query returns hits, even with unmatched terms", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits, didYouMean } = await client.search("widget zzzznotaword", {
      fuzzy: true,
    });
    expect(hits).toEqual([]); // boolean AND: the nonsense term fails the whole query
    expect(didYouMean).toBeUndefined(); // no hits, but only because zzzznotaword has no near match either
  });
});

describe("result highlighting (options.highlight)", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let outDir: string;

  const highlightSources: SourceDocument[] = [
    {
      id: 1,
      url: "/widgets",
      html: `<html lang="en"><head><title>Premium Widgets</title>
        <meta name="description" content="Our widgets are built to last a lifetime."></head>
        <body><main><p>widgets widgets widgets</p></main></body></html>`,
    },
    {
      id: 2,
      url: "/about",
      html: `<html lang="en"><head><title>About Us</title></head>
        <body><main><p>We are a small company that makes things.</p></main></body></html>`,
    },
  ];

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "csf-e2e-highlight-"));
    await writeIndex(buildIndex(highlightSources), outDir);
    const server = await serveStatic(outDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  afterAll(async () => {
    await closeServer();
    await rm(outDir, { recursive: true, force: true });
  });

  it("omits highlights by default", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("widgets");
    expect(hits[0]?.highlights).toBeUndefined();
  });

  it("splits every stored field into match/non-match spans when requested", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("widgets", { highlight: true });
    const hit = hits[0];
    expect(hit?.highlights?.title).toEqual([
      { text: "Premium ", isMatch: false },
      { text: "Widgets", isMatch: true },
    ]);
    expect(hit?.highlights?.excerpt).toEqual([
      { text: "Our ", isMatch: false },
      { text: "widgets", isMatch: true },
      { text: " are built to last a lifetime.", isMatch: false },
    ]);
  });

  it("does not highlight terms absent from a hit's fields", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("company", { highlight: true });
    const hit = hits.find((h) => h.url === "/about");
    expect(hit?.highlights?.title).toEqual([
      { text: "About Us", isMatch: false },
    ]);
    expect(hit?.highlights?.excerpt?.some((s) => s.isMatch)).toBe(true);
  });

  it("is prefix-aware, matching the whole word for a term* query", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const { hits } = await client.search("widg*", { highlight: true });
    expect(hits[0]?.highlights?.title).toEqual([
      { text: "Premium ", isMatch: false },
      { text: "Widgets", isMatch: true },
    ]);
  });
});
