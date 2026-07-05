import { mkdtemp, rm } from "node:fs/promises";
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
