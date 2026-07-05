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
    const hits = await client.search("widgets");

    expect(hits.map((h) => h.id)).toEqual([1, 2]); // 3/about never mentions widgets
    expect(hits[0]?.url).toBe("/widgets");
    expect(hits[0]?.fields.title).toBe("Widgets");
    expect((hits[0]?.score ?? 0) > (hits[1]?.score ?? 0)).toBe(true);
  });

  it("excludes csf-noindex documents from being findable at all", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const hits = await client.search("widgets");
    expect(hits.some((h) => h.url === "/draft")).toBe(false);
  });

  it("boolean-ANDs multiple query terms", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const hits = await client.search("gadgets gizmos");
    expect(hits.map((h) => h.id)).toEqual([2]);
  });

  it("returns no results when a query term matches nothing", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    expect(await client.search("nonexistentterm")).toEqual([]);
  });

  it("uses the derived excerpt when no meta description was given", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const hits = await client.search("company");
    expect(hits[0]?.fields.excerpt).toContain("small company");
  });

  it("prefers the explicit meta description as the excerpt when present", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const hits = await client.search("widgets");
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
    const hits = await client.search("widgets");
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
    const hits = await client.search("widgets");
    expect(hits[0]?.id).toBe(2);
  });

  it("flips the ranking when the query overrides title far above body", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const hits = await client.search("widgets", {
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
    const hits = await client.search("apple banana");
    expect(hits[0]?.score).toBeCloseTo(hits[1]?.score ?? Number.NaN);
  });

  it("boosting a term tips the tie toward the doc with more of that term", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const hits = await client.search("apple banana", {
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
    const hits = await client.search("widg*");
    expect(hits.map((h) => h.id).sort()).toEqual([1, 2, 3]);
  });

  it("does not match documents outside the prefix", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const hits = await client.search("widg*");
    expect(hits.some((h) => h.id === 4)).toBe(false);
  });

  it("still ANDs a prefix clause against other exact clauses", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const hits = await client.search("widg* bulk");
    expect(hits.map((h) => h.id)).toEqual([2]);
  });

  it("returns no results when a prefix matches no real term", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    expect(await client.search("zzz*")).toEqual([]);
  });

  it("falls back to an exact match when there's no trailing *", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    const hits = await client.search("widget");
    expect(hits.map((h) => h.id)).toEqual([1]); // not 2 or 3
  });
});
