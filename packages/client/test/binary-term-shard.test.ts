import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { termsWithBinaryPrefix } from "../src/binary-term-shard.js";
import { SearchClient } from "../src/client.js";
import type { PythonSourceDocument } from "../test-support/python-index.js";
import { writePythonIndex } from "../test-support/python-index.js";
import { serveStatic } from "./static-server.js";

describe("termsWithBinaryPrefix (binary search over a sorted term directory)", () => {
  const sortedTerms = [
    "alpha",
    "beta",
    "widget",
    "widgetry",
    "widgets",
    "zebra",
  ];

  it("finds every term sharing a prefix, in sorted order", () => {
    expect(termsWithBinaryPrefix(sortedTerms, "widget")).toEqual([
      "widget",
      "widgetry",
      "widgets",
    ]);
  });

  it("finds a single exact-match term when the prefix is the whole term", () => {
    expect(termsWithBinaryPrefix(sortedTerms, "zebra")).toEqual(["zebra"]);
  });

  it("returns an empty array when no term matches", () => {
    expect(termsWithBinaryPrefix(sortedTerms, "xyz")).toEqual([]);
  });

  it("matches a prefix at the very start of the sorted array", () => {
    expect(termsWithBinaryPrefix(sortedTerms, "al")).toEqual(["alpha"]);
  });

  it("matches a prefix at the very end of the sorted array", () => {
    expect(termsWithBinaryPrefix(sortedTerms, "z")).toEqual(["zebra"]);
  });

  it("returns every term for an empty prefix", () => {
    expect(termsWithBinaryPrefix(sortedTerms, "")).toEqual(sortedTerms);
  });

  it("returns an empty array against an empty term list", () => {
    expect(termsWithBinaryPrefix([], "anything")).toEqual([]);
  });
});

/**
 * Binary term shards (docs/concepts/binary-storage.md, docs/archive/specs/binary-format.md,
 * `writeIndex(built, outDir, { termShardFormat: "binary" })`) must return
 * exactly the same logical search results as the equivalent JSON-shard
 * index (`archive/specs/binary-format.md#success-criteria`: "Binary and JSON
 * indexes must return identical logical search results for the same
 * corpus, configuration and query"). This builds the *same* corpus both
 * ways and runs the same real-HTTP `SearchClient` query across every
 * feature that touches term shards -- exact, prefix, multi-term AND,
 * phrase, synonym expansion, fuzzy matching, and facet-filtered search
 * -- asserting identical hit ids *and* identical scores, not just that
 * both return non-empty results.
 */

const sources: PythonSourceDocument[] = [
  {
    id: 1,
    url: "/widgets",
    html: `<html lang="en"><head><title>Amazing Widgets</title>
      <meta name="searchable-facet-category" content="hardware">
      <meta name="searchable-boost" content="1.8"></head>
      <body><main><p>Our widgets are wonderful. Buy widgets today. Premium
      support included. Contact support for details. Noise cancelling
      headphones included free.</p></main></body></html>`,
  },
  {
    id: 2,
    url: "/gadgets",
    html: `<html lang="en"><head><title>Gadgets</title>
      <meta name="searchable-facet-category" content="hardware"></head>
      <body><main><p>Gadgets and gizmos, plus a few widgets for good
      measure. Basic support only.</p></main></body></html>`,
  },
  {
    id: 3,
    url: "/sofa",
    html: `<html lang="en"><head><title>Sofa Selection</title>
      <meta name="searchable-facet-category" content="furniture"></head>
      <body><main><p>Our sofa selection is huge.</p></main></body></html>`,
  },
  {
    id: 4,
    url: "/couch-brand",
    html: `<html lang="en"><head><title>Brand X Couch</title>
      <meta name="searchable-facet-category" content="furniture"></head>
      <body><main><p>The Brand X couch is elegant.</p></main></body></html>`,
  },
];

const buildOptions = {
  synonyms: { en: { equivalences: [["sofa", "couch"]] } },
  fuzzy: true,
} as const;

describe("binary term shards return identical results to JSON (real HTTP)", () => {
  let jsonBaseUrl: string;
  let closeJsonServer: () => Promise<void>;
  let jsonBuilt: { outDir: string; cleanup: () => Promise<void> };

  let binaryBaseUrl: string;
  let closeBinaryServer: () => Promise<void>;
  let binaryBuilt: { outDir: string; cleanup: () => Promise<void> };

  beforeAll(async () => {
    jsonBuilt = await writePythonIndex(sources, {
      defaultLanguage: "en",
      ...buildOptions,
    });
    const jsonServer = await serveStatic(jsonBuilt.outDir);
    jsonBaseUrl = jsonServer.baseUrl;
    closeJsonServer = jsonServer.close;

    binaryBuilt = await writePythonIndex(
      sources,
      { defaultLanguage: "en", ...buildOptions },
      { termShardFormat: "binary" },
    );
    const binaryServer = await serveStatic(binaryBuilt.outDir);
    binaryBaseUrl = binaryServer.baseUrl;
    closeBinaryServer = binaryServer.close;
  });

  afterAll(async () => {
    await Promise.all([closeJsonServer(), closeBinaryServer()]);
    await Promise.all([jsonBuilt.cleanup(), binaryBuilt.cleanup()]);
  });

  function clients() {
    return {
      json: new SearchClient({ indexUrl: `${jsonBaseUrl}manifest.json` }),
      binary: new SearchClient({ indexUrl: `${binaryBaseUrl}manifest.json` }),
    };
  }

  it("records format: 'binary' on the binary manifest's term shard entries, absent on the JSON one", async () => {
    const { json, binary } = clients();
    const [jsonManifest, binaryManifest] = await Promise.all([
      json
        .ready()
        .then(() => fetch(`${jsonBaseUrl}manifest.json`).then((r) => r.json())),
      binary
        .ready()
        .then(() =>
          fetch(`${binaryBaseUrl}manifest.json`).then((r) => r.json()),
        ),
    ]);
    expect(
      jsonManifest.shards.terms.every((s: { format?: string }) => !s.format),
    ).toBe(true);
    expect(
      binaryManifest.shards.terms.every(
        (s: { format?: string }) => s.format === "binary",
      ),
    ).toBe(true);
  });

  it("exact-term query: identical hit ids and scores", async () => {
    const { json, binary } = clients();
    const [jsonResult, binaryResult] = await Promise.all([
      json.search("support"),
      binary.search("support"),
    ]);
    expect(binaryResult.hits.map((h) => h.id)).toEqual(
      jsonResult.hits.map((h) => h.id),
    );
    expect(binaryResult.hits.map((h) => h.score)).toEqual(
      jsonResult.hits.map((h) => h.score),
    );
    expect(jsonResult.hits.map((h) => h.id).sort()).toEqual([1, 2]);
  });

  it("prefix query (term*): identical hit ids and scores", async () => {
    const { json, binary } = clients();
    const [jsonResult, binaryResult] = await Promise.all([
      json.search("widg*"),
      binary.search("widg*"),
    ]);
    expect(binaryResult.hits.map((h) => h.id)).toEqual(
      jsonResult.hits.map((h) => h.id),
    );
    expect(binaryResult.hits.map((h) => h.score)).toEqual(
      jsonResult.hits.map((h) => h.score),
    );
    expect(jsonResult.hits.map((h) => h.id).sort()).toEqual([1, 2]);
  });

  it("multi-term boolean-AND query: identical hit ids and scores", async () => {
    const { json, binary } = clients();
    const [jsonResult, binaryResult] = await Promise.all([
      json.search("widgets support"),
      binary.search("widgets support"),
    ]);
    expect(binaryResult.hits.map((h) => h.id)).toEqual(
      jsonResult.hits.map((h) => h.id),
    );
    expect(binaryResult.hits.map((h) => h.score)).toEqual(
      jsonResult.hits.map((h) => h.score),
    );
  });

  it('"quoted phrase" query (position-adjacency): identical hit ids', async () => {
    const { json, binary } = clients();
    const [jsonResult, binaryResult] = await Promise.all([
      json.search('"noise cancelling"'),
      binary.search('"noise cancelling"'),
    ]);
    expect(binaryResult.hits.map((h) => h.id)).toEqual(
      jsonResult.hits.map((h) => h.id),
    );
    expect(jsonResult.hits.map((h) => h.id)).toEqual([1]);
  });

  it("synonym expansion (options.synonyms): identical hit ids and scores", async () => {
    const { json, binary } = clients();
    const [jsonResult, binaryResult] = await Promise.all([
      json.search("sofa", { synonyms: true }),
      binary.search("sofa", { synonyms: true }),
    ]);
    expect(binaryResult.hits.map((h) => h.id)).toEqual(
      jsonResult.hits.map((h) => h.id),
    );
    expect(binaryResult.hits.map((h) => h.score)).toEqual(
      jsonResult.hits.map((h) => h.score),
    );
    expect(jsonResult.hits.map((h) => h.id).sort()).toEqual([3, 4]);
  });

  it("fuzzy matching (options.fuzzy): identical hit ids for a typo query", async () => {
    const { json, binary } = clients();
    // "widgits" is a one-character-substitution typo of "widget" (the
    // stemmed form of "widgets").
    const [jsonResult, binaryResult] = await Promise.all([
      json.search("widgits", { fuzzy: true }),
      binary.search("widgits", { fuzzy: true }),
    ]);
    expect(binaryResult.hits.map((h) => h.id)).toEqual(
      jsonResult.hits.map((h) => h.id),
    );
    expect(jsonResult.hits.map((h) => h.id).sort()).toEqual([1, 2]);
  });

  it("facet-filtered search: identical hit ids when combined with a binary term-shard query", async () => {
    const { json, binary } = clients();
    const [jsonResult, binaryResult] = await Promise.all([
      json.search("widgets", { filters: { category: "hardware" } }),
      binary.search("widgets", { filters: { category: "hardware" } }),
    ]);
    expect(binaryResult.hits.map((h) => h.id)).toEqual(
      jsonResult.hits.map((h) => h.id),
    );
    expect(jsonResult.hits.map((h) => h.id).sort()).toEqual([1, 2]);
  });

  it("document boost (searchable-boost) still ranks the boosted doc first from a binary term shard", async () => {
    const { json, binary } = clients();
    const [jsonResult, binaryResult] = await Promise.all([
      json.search("widgets"),
      binary.search("widgets"),
    ]);
    // doc 1 has searchable-boost content="1.8"; both implementations must rank
    // it first identically, not just agree on the unordered hit set.
    expect(binaryResult.hits.map((h) => h.id)).toEqual(
      jsonResult.hits.map((h) => h.id),
    );
    expect(jsonResult.hits[0]?.id).toBe(1);
  });

  it("no-match query: both return zero hits", async () => {
    const { json, binary } = clients();
    const [jsonResult, binaryResult] = await Promise.all([
      json.search("xyzzyquux"),
      binary.search("xyzzyquux"),
    ]);
    expect(jsonResult.hits).toEqual([]);
    expect(binaryResult.hits).toEqual([]);
  });
});
