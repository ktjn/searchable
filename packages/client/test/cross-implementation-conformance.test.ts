import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SearchClient } from "../src/client.js";
import type { PythonSourceDocument } from "../test-support/python-index.js";
import { writePythonIndex } from "../test-support/python-index.js";
import { serveStatic } from "./static-server.js";

/**
 * Cross-implementation conformance (docs/project/governance.md's
 * "Cross-implementation conformance" bullet, tracked as a deliverable
 * in docs/project/roadmap.md): indexes the *same* fixture corpus
 * (spec/examples/documents.json) two ways -- the real
 * `python/searchable-indexer` reference indexer (via the
 * `writePythonIndex` test helper), and the independent, from-scratch
 * Python generator (spec/examples/python/generate_index.py, sharing no
 * code with `searchable-indexer` or `@ktjn/searchable-client`) -- and
 * runs the *same* end-to-end query assertions against both outputs
 * over real HTTP via the real `SearchClient`. spec/examples/README.md
 * already proves the two generators produce structurally comparable
 * output; this is the stronger claim that README explicitly says it
 * doesn't make on its own: a real index built by an independent, from-
 * scratch, non-stemming producer actually loads and queries correctly
 * through this project's own client, not just that the bytes on disk
 * look similar.
 *
 * The Python generator's tokenization (lowercase, strip tags, split on
 * `[a-z0-9]+`, no stemming, no stopwords, no field boosts) deliberately
 * differs from `searchable-analysis`'s real pipeline (Porter stemming,
 * field boosts, stopwords) -- see spec/examples/README.md's "note what
 * this does and doesn't prove". Since `@ktjn/searchable-client`'s query
 * analysis always runs the real stemmer regardless of which backend
 * built the index, a query word only produces the same lookup key
 * against *both* outputs if its stem equals its own surface form (e.g.
 * "support", not "widgets" -> "widget"); spec/examples/documents.json's
 * fixture text was chosen with this in mind so the same literal query
 * string is a fair, meaningful test of both implementations, not an
 * artifact of one side's stemming.
 */

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const documentsJsonPath = join(repoRoot, "spec", "examples", "documents.json");
const pythonGeneratorPath = join(
  repoRoot,
  "spec",
  "examples",
  "python",
  "generate_index.py",
);

interface FixtureDoc {
  id: number;
  url: string;
  title: string;
  body: string;
}

describe("cross-implementation conformance (real searchable-indexer vs. independent Python generator)", () => {
  let realBaseUrl: string;
  let closeRealServer: () => Promise<void>;
  let realCleanup: () => Promise<void>;

  let refBaseUrl: string;
  let closeRefServer: () => Promise<void>;
  let refOutDir: string;

  beforeAll(async () => {
    const fixtureDocs: FixtureDoc[] = JSON.parse(
      await readFile(documentsJsonPath, "utf8"),
    );

    // --- Real side: the real `searchable-indexer` reference indexer ---
    const sources: PythonSourceDocument[] = fixtureDocs.map((doc) => ({
      id: doc.id,
      url: doc.url,
      html: `<html lang="en"><head><title>${doc.title}</title></head><body><main><p>${doc.body}</p></main></body></html>`,
    }));
    const realBuild = await writePythonIndex(sources);
    realCleanup = realBuild.cleanup;
    const realServer = await serveStatic(realBuild.outDir);
    realBaseUrl = realServer.baseUrl;
    closeRealServer = realServer.close;

    // --- Reference side: the independent, from-scratch generator ---
    refOutDir = await mkdtemp(join(tmpdir(), "searchable-conformance-ref-"));
    execFileSync(
      "python3",
      [pythonGeneratorPath, documentsJsonPath, refOutDir],
      { stdio: "pipe" },
    );
    const refServer = await serveStatic(refOutDir);
    refBaseUrl = refServer.baseUrl;
    closeRefServer = refServer.close;
  });

  afterAll(async () => {
    await Promise.all([closeRealServer(), closeRefServer()]);
    await Promise.all([
      realCleanup(),
      rm(refOutDir, { recursive: true, force: true }),
    ]);
  });

  it("both implementations return the same matching doc ids for a single-term query", async () => {
    const realClient = new SearchClient({
      indexUrl: `${realBaseUrl}manifest.json`,
    });
    const refClient = new SearchClient({
      indexUrl: `${refBaseUrl}manifest.json`,
    });

    const realHits = (await realClient.search("support")).hits
      .map((h) => h.id)
      .sort();
    const refHits = (await refClient.search("support")).hits
      .map((h) => h.id)
      .sort();

    // doc 1 ("Premium support included. Contact support for details.")
    // and doc 2 ("Basic support only.") both contain "support"; doc 3
    // does not. "support" stems to itself, so it's a fair query for both
    // the real stemming indexer and the independent generator's literal
    // tokenization.
    expect(realHits).toEqual([1, 2]);
    expect(refHits).toEqual([1, 2]);
  });

  it("both implementations rank the document with more matches first", async () => {
    const realClient = new SearchClient({
      indexUrl: `${realBaseUrl}manifest.json`,
    });
    const refClient = new SearchClient({
      indexUrl: `${refBaseUrl}manifest.json`,
    });

    // doc 1 matches "support" twice; doc 2 matches once -- true
    // regardless of field-boost differences between the two generators.
    const realHits = (await realClient.search("support")).hits;
    const refHits = (await refClient.search("support")).hits;
    expect(realHits[0]?.id).toBe(1);
    expect(refHits[0]?.id).toBe(1);
  });

  it("both implementations resolve a multi-term boolean-AND query to the same doc id", async () => {
    const realClient = new SearchClient({
      indexUrl: `${realBaseUrl}manifest.json`,
    });
    const refClient = new SearchClient({
      indexUrl: `${refBaseUrl}manifest.json`,
    });

    // Only doc 3 ("About Us" / "We are a small company that makes
    // things.") contains both "small" and "about"; both words stem to
    // themselves.
    const realHits = (await realClient.search("small about")).hits.map(
      (h) => h.id,
    );
    const refHits = (await refClient.search("small about")).hits.map(
      (h) => h.id,
    );
    expect(realHits).toEqual([3]);
    expect(refHits).toEqual([3]);
  });

  it("both implementations return no hits for a term absent from the corpus", async () => {
    const realClient = new SearchClient({
      indexUrl: `${realBaseUrl}manifest.json`,
    });
    const refClient = new SearchClient({
      indexUrl: `${refBaseUrl}manifest.json`,
    });

    expect((await realClient.search("xyzzyquux")).hits).toEqual([]);
    expect((await refClient.search("xyzzyquux")).hits).toEqual([]);
  });
});
