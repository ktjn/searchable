import { generateCms2kCorpus } from "@ktjn/searchable-fixtures";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SearchClient } from "../src/client.js";
import type { SearchOptions } from "../src/search.js";
import type { PythonBuildOptions } from "../test-support/python-index.js";
import { writePythonIndex } from "../test-support/python-index.js";
import { serveStatic } from "./static-server.js";

/**
 * The configuration testbed (docs/project/governance.md#testing,
 * docs/project/roadmap.md Phase 6): generalizes the idea of "a fixed query
 * set against a fixed corpus" to a *matrix* of build/query
 * configurations against that corpus, so a tuning change (e.g. "raise
 * the default title boost") can be checked across every configuration
 * people actually run, not just whichever one a one-off test happens
 * to use. Each (configuration, query) result is snapshotted -- an
 * intentional change to ranking shows up as a reviewable diff here,
 * the same way a UI screenshot test catches an unintended visual
 * change.
 *
 * v1 scope: build-time-varying knobs (field boosts, fuzzy) against the
 * CMS-2k fixture's existing vocabulary. A synonyms variant isn't
 * included yet -- the fixture's prose doesn't contain deliberately
 * paired synonym vocabulary (unlike showcase/gallery-synonyms-data.ts),
 * so a meaningful synonym configuration needs either new fixture
 * content or its own dedicated corpus; left for a follow-up rather
 * than bolted on to content that wouldn't actually exercise it.
 */

interface ConfigVariant {
  name: string;
  build: PythonBuildOptions;
  search: SearchOptions;
}

const VARIANTS: ConfigVariant[] = [
  { name: "default", build: {}, search: {} },
  {
    // Field boosts resolve from the manifest at *query* time
    // (packages/client/src/score.ts), with a per-query override --
    // so this variant reuses the default build and only overrides
    // boosts.fields, rather than needing its own index build.
    name: "high-title-boost",
    build: {},
    search: { boosts: { fields: { title: 8 } } },
  },
  {
    name: "fuzzy-strict",
    build: { fuzzy: true },
    search: { fuzzy: true, fuzzyWeight: 0.2 },
  },
  {
    name: "fuzzy-lenient",
    build: { fuzzy: true },
    search: { fuzzy: true, fuzzyWeight: 0.9 },
  },
];

/**
 * "boosts" appears in the title of some generated documents ("...
 * Field Boosts") and only in the body prose of many others (a
 * different topic's paragraphs also happen to discuss boosts) --
 * exactly the split needed for a title-boost change to visibly
 * reorder results, unlike a term that's title-only or body-only
 * everywhere it appears. "shar" is a genuine one-deletion typo of
 * "shard" -- the classic-Porter-stemmed form "sharding" now indexes as
 * (docs/guides/internationalization.md#stemming), not the un-stemmed surface
 * form itself, so the typo has to be a true edit distance 1 from the
 * *stemmed* real term for the strict maxEdits:1 dictionary to ever
 * find it (verified directly against the built fixture's fuzzy shard,
 * not just assumed) -- findable only when a variant's search options
 * enable fuzzy matching. "the" is ubiquitous, a stable high-recall
 * control query.
 */
const QUERY_SET = ["boosts", "shar", "the"];

function round(score: number): number {
  return Math.round(score * 10000) / 10000;
}

describe("configuration testbed (matrix of build/query configs, snapshotted per combination)", () => {
  const servers = new Map<
    string,
    { baseUrl: string; close: () => Promise<void> }
  >();
  const cleanups: Array<() => Promise<void>> = [];

  beforeAll(async () => {
    const sources = generateCms2kCorpus({ count: 300, languages: ["en"] });
    for (const variant of VARIANTS) {
      const { outDir, cleanup } = await writePythonIndex(sources, {
        defaultLanguage: "en",
        ...variant.build,
      });
      cleanups.push(cleanup);
      const server = await serveStatic(outDir);
      servers.set(variant.name, server);
    }
    // Each variant now shells out to a real `uv run python` build (Python
    // interpreter + uv resolution overhead per invocation, not an in-process
    // TS call), so this loop can exceed vitest's default 10s hook timeout on
    // a colder/slower CI runner even though it's comfortably fast locally.
  }, 60_000);

  afterAll(async () => {
    await Promise.all([...servers.values()].map((s) => s.close()));
    await Promise.all(cleanups.map((cleanup) => cleanup()));
  });

  for (const variant of VARIANTS) {
    for (const query of QUERY_SET) {
      it(`${variant.name} :: "${query}"`, async () => {
        const server = servers.get(variant.name);
        if (!server) throw new Error(`no server for variant ${variant.name}`);
        const client = new SearchClient({
          indexUrl: `${server.baseUrl}manifest.json`,
        });
        const result = await client.search(query, {
          ...variant.search,
          limit: 5,
        });
        expect({
          totalHits: result.totalHits,
          hits: result.hits.map((h) => ({ url: h.url, score: round(h.score) })),
        }).toMatchSnapshot();
      });
    }
  }
});
