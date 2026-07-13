import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SourceDocument } from "@ktjn/searchable-indexer";
import { buildIndex, writeIndex } from "@ktjn/searchable-indexer";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { SearchClient } from "../src/client.js";
import { serveStatic } from "./static-server.js";

/**
 * Issue #1 finding 8 (productization review): the fuzzy path computes
 * Levenshtein distance for every dictionary candidate a deletion-variant
 * bucket returns, with no upper bound -- a dense vocabulary or a common
 * short deletion key can make that set large. This builds a genuinely
 * dense vocabulary (many real terms that all collide on one common
 * deletion-dictionary key) to prove `search.ts`'s
 * `MAX_FUZZY_CANDIDATES_PER_TERM` cap actually engages: the query still
 * returns (no unbounded CPU blowup) and a console.warn names the
 * overflow, while a normal small fuzzy vocabulary (every other fuzzy
 * test in this repo) never warns at all.
 *
 * BASE has 10 distinct letters (no repeats) specifically so that
 * inserting a letter at each of the 11 possible positions produces (with
 * only rare adjacent-duplicate collisions) close to 11*26 = 286 distinct
 * real terms, each one exactly one deletion away from BASE -- i.e. all
 * of them collide on BASE as a shared deletion-dictionary key.
 */
const BASE = "abcdefghij";
const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

function makeDenseVocabulary(base: string, minCount: number): string[] {
  const variants = new Set<string>();
  for (let pos = 0; pos <= base.length && variants.size < minCount * 2; pos++) {
    for (const letter of ALPHABET) {
      const candidate = base.slice(0, pos) + letter + base.slice(pos);
      if (candidate !== base) variants.add(candidate);
    }
  }
  return [...variants];
}

const denseTerms = makeDenseVocabulary(BASE, 210);

function makeDenseSources(): SourceDocument[] {
  // One term per document, each document's body just that one term --
  // keeps the corpus trivial to reason about (id N <-> denseTerms[N-1]).
  return denseTerms.map((term, i) => ({
    id: i + 1,
    url: `/dense-${i + 1}`,
    html: `<html lang="en"><head><title>Dense ${i + 1}</title></head>
      <body><main><p>${term}</p></main></body></html>`,
  }));
}

describe("fuzzy candidate cap (real HTTP)", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let outDir: string;

  beforeAll(async () => {
    expect(denseTerms.length).toBeGreaterThan(200);

    outDir = await mkdtemp(join(tmpdir(), "searchable-fuzzy-cap-"));
    const built = buildIndex(makeDenseSources(), "en", { fuzzy: true });
    await writeIndex(built, outDir);
    const server = await serveStatic(outDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  afterAll(async () => {
    await closeServer();
    await rm(outDir, { recursive: true, force: true });
  });

  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("still returns results for a query hitting a dense deletion-dictionary key", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    // BASE itself was never indexed as a real term, only as a shared
    // deletion-variant key -- every one of denseTerms is a genuine
    // distance-1 fuzzy match for it.
    const { hits } = await client.search(BASE, { fuzzy: true, limit: 500 });
    expect(hits.length).toBeGreaterThan(0);
  });

  it("warns that the candidate cap was hit, naming the query term", async () => {
    const client = new SearchClient({ indexUrl: `${baseUrl}manifest.json` });
    await client.search(BASE, { fuzzy: true, limit: 500 });

    const capWarnings = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("candidate cap"),
    );
    expect(capWarnings.length).toBeGreaterThan(0);
    expect(String(capWarnings[0]?.[0])).toContain(`"${BASE}"`);
  });

  it("does not warn for an ordinary, small fuzzy vocabulary (every other fuzzy test in this repo)", async () => {
    const smallOutDir = await mkdtemp(
      join(tmpdir(), "searchable-fuzzy-cap-small-"),
    );
    const smallSources: SourceDocument[] = [
      {
        id: 1,
        url: "/widget",
        html: `<html lang="en"><head><title>Widget</title></head>
          <body><main><p>All about the widget.</p></main></body></html>`,
      },
    ];
    await writeIndex(
      buildIndex(smallSources, "en", { fuzzy: true }),
      smallOutDir,
    );
    const smallServer = await serveStatic(smallOutDir);

    const client = new SearchClient({
      indexUrl: `${smallServer.baseUrl}manifest.json`,
    });
    await client.search("widgit", { fuzzy: true });

    const capWarnings = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("candidate cap"),
    );
    expect(capWarnings).toHaveLength(0);

    await smallServer.close();
    await rm(smallOutDir, { recursive: true, force: true });
  });
});
