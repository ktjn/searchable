import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SearchClient } from "../src/client.js";
import type { Hit, SearchOptions, SearchResult } from "../src/search.js";
import type { PythonSourceDocument } from "../test-support/python-index.js";
import { writePythonIndex } from "../test-support/python-index.js";
import { serveStatic } from "./static-server.js";

interface ConformanceCase {
  id: string;
  query: string;
  options: SearchOptions;
}

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const casesPath = join(
  repoRoot,
  "spec",
  "fixtures",
  "client-conformance",
  "cases.json",
);
const pythonDir = join(repoRoot, "python", "searchable");
const pythonRunner = join(
  pythonDir,
  "tests",
  "fixtures",
  "client_conformance_runner.py",
);
const cases: ConformanceCase[] = JSON.parse(readFileSync(casesPath, "utf8"));

const sources: PythonSourceDocument[] = [
  {
    id: 1,
    url: "/london-sofa",
    html: `<html lang="en"><head><title>Red Sofa Widget</title>
      <meta name="searchable-facet-category" content="red">
      <meta name="searchable-facet-range-price" content="10">
      <meta name="searchable-facet-geo-location" content="51.5074,-0.1278"></head>
      <body><main><p>A sofa widget store in London.</p></main></body></html>`,
  },
  {
    id: 2,
    url: "/new-york-couch",
    html: `<html lang="en"><head><title>Blue Couch Widget</title>
      <meta name="searchable-facet-category" content="blue">
      <meta name="searchable-facet-range-price" content="20">
      <meta name="searchable-facet-geo-location" content="40.7128,-74.0060"></head>
      <body><main><p>A couch widget store in New York.</p></main></body></html>`,
  },
  {
    id: 3,
    url: "/tokyo-gadget",
    html: `<html lang="en"><head><title>Red Gadget</title>
      <meta name="searchable-facet-category" content="red">
      <meta name="searchable-facet-range-price" content="30">
      <meta name="searchable-facet-geo-location" content="35.6762,139.6503"></head>
      <body><main><p>A gadget store in Tokyo.</p></main></body></html>`,
  },
];

function stableHit(hit: Hit) {
  return {
    id: hit.id,
    url: hit.url,
    fields: hit.fields,
    pinned: hit.pinned ?? false,
    highlights: hit.highlights ?? null,
    externalId: hit.externalId ?? null,
    metadata: hit.metadata ?? null,
    contentHash: hit.contentHash ?? null,
  };
}

function stableFacets(facets: SearchResult["facets"]) {
  if (!facets) return null;
  return Object.fromEntries(
    Object.entries(facets).map(([field, facet]) => [
      field,
      { values: facet.values, separator: facet.separator ?? null },
    ]),
  );
}

describe("TypeScript and Python client conformance", () => {
  let client: SearchClient;
  let pythonResults: Record<string, SearchResult>;
  let closeServer: () => Promise<void>;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const index = await writePythonIndex(sources, {
      synonyms: { en: { equivalences: [["sofa", "couch"]] } },
      fuzzy: true,
    });
    cleanup = index.cleanup;
    const server = await serveStatic(index.outDir);
    closeServer = server.close;
    client = new SearchClient({ indexUrl: `${server.baseUrl}manifest.json` });

    pythonResults = JSON.parse(
      execFileSync(
        "uv",
        [
          "run",
          "python",
          pythonRunner,
          join(index.outDir, "manifest.json"),
          casesPath,
        ],
        { cwd: pythonDir, encoding: "utf8" },
      ),
    );
  });

  afterAll(async () => {
    await closeServer();
    await cleanup();
  });

  it.each(cases)("matches the Python client for $id", async (testCase) => {
    const typescript = await client.search(testCase.query, testCase.options);
    const python = pythonResults[testCase.id];

    expect(typescript.totalHits).toBe(python.totalHits);
    expect(typescript.language).toBe(python.language);
    expect(stableFacets(typescript.facets)).toEqual(
      stableFacets(python.facets),
    );
    expect(typescript.didYouMean ?? null).toEqual(python.didYouMean);
    expect(typescript.hits).toHaveLength(python.hits.length);
    for (const [index, hit] of typescript.hits.entries()) {
      const pythonHit = python.hits[index] as Hit;
      expect(stableHit(hit)).toEqual(stableHit(pythonHit));
      expect(hit.score).toBeCloseTo(pythonHit.score, 8);
      if (hit.distanceKm === undefined) {
        expect(pythonHit.distanceKm).toBeNull();
      } else {
        expect(hit.distanceKm).toBeCloseTo(pythonHit.distanceKm ?? 0, 8);
      }
    }
  });
});
