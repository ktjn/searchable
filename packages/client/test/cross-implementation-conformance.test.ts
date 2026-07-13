import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SourceDocument } from "@ktjn/searchable-indexer";
import { buildIndex, writeIndex } from "@ktjn/searchable-indexer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SearchClient } from "../src/client.js";
import { serveStatic } from "./static-server.js";

/**
 * Cross-implementation conformance (docs/project/governance.md#performance-policy's
 * "Cross-implementation conformance" bullet, tracked as a Phase 0/7
 * deliverable in spec/examples/README.md's own "note what this does and
 * doesn't prove" section): indexes the *same* fixture corpus
 * (spec/examples/documents.json) two ways -- the real `@ktjn/searchable-indexer`
 * reference indexer, and the independent, from-scratch Python generator
 * (spec/examples/python/generate_index.py, sharing no code with
 * `@ktjn/searchable-indexer` or `@ktjn/searchable-client`) -- and runs the *same* end-to-end
 * query assertions against both outputs over real HTTP via the real
 * `SearchClient`. spec/examples/README.md already proves the two
 * generators produce structurally comparable output; this is the
 * stronger claim that README explicitly says it doesn't make on its
 * own: a real index built by an independent, non-TypeScript, non-
 * stemming producer actually loads and queries correctly through this
 * project's own client, not just that the bytes on disk look similar.
 *
 * The Python generator's tokenization (lowercase, strip tags, split on
 * `[a-z0-9]+`, no stemming, no stopwords, no field boosts) deliberately
 * differs from `@ktjn/searchable-analysis`'s real pipeline (Porter stemming, field
 * boosts, stopwords) -- see spec/examples/README.md's "note what this
 * does and doesn't prove". Since `@ktjn/searchable-client`'s query analysis always
 * runs the real stemmer regardless of which backend built the index, a
 * query word only produces the same lookup key against *both* outputs
 * if its stem equals its own surface form (e.g. "support", not
 * "widgets" -> "widget"); spec/examples/documents.json's fixture text
 * was chosen with this in mind so the same literal query string is a
 * fair, meaningful test of both implementations, not an artifact of
 * one side's stemming.
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

describe("cross-implementation conformance (real TypeScript indexer vs. independent Python generator)", () => {
  let tsBaseUrl: string;
  let closeTsServer: () => Promise<void>;
  let tsOutDir: string;

  let pyBaseUrl: string;
  let closePyServer: () => Promise<void>;
  let pyOutDir: string;

  beforeAll(async () => {
    const fixtureDocs: FixtureDoc[] = JSON.parse(
      await readFile(documentsJsonPath, "utf8"),
    );

    // --- TypeScript side: the real reference indexer ---
    const sources: SourceDocument[] = fixtureDocs.map((doc) => ({
      id: doc.id,
      url: doc.url,
      html: `<html lang="en"><head><title>${doc.title}</title></head><body><main><p>${doc.body}</p></main></body></html>`,
    }));
    tsOutDir = await mkdtemp(join(tmpdir(), "searchable-conformance-ts-"));
    await writeIndex(buildIndex(sources), tsOutDir);
    const tsServer = await serveStatic(tsOutDir);
    tsBaseUrl = tsServer.baseUrl;
    closeTsServer = tsServer.close;

    // --- Python side: the independent, from-scratch generator ---
    pyOutDir = await mkdtemp(join(tmpdir(), "searchable-conformance-py-"));
    execFileSync(
      "python3",
      [pythonGeneratorPath, documentsJsonPath, pyOutDir],
      { stdio: "pipe" },
    );
    const pyServer = await serveStatic(pyOutDir);
    pyBaseUrl = pyServer.baseUrl;
    closePyServer = pyServer.close;
  });

  afterAll(async () => {
    await Promise.all([closeTsServer(), closePyServer()]);
    await Promise.all([
      rm(tsOutDir, { recursive: true, force: true }),
      rm(pyOutDir, { recursive: true, force: true }),
    ]);
  });

  it("both implementations return the same matching doc ids for a single-term query", async () => {
    const tsClient = new SearchClient({
      indexUrl: `${tsBaseUrl}manifest.json`,
    });
    const pyClient = new SearchClient({
      indexUrl: `${pyBaseUrl}manifest.json`,
    });

    const tsHits = (await tsClient.search("support")).hits
      .map((h) => h.id)
      .sort();
    const pyHits = (await pyClient.search("support")).hits
      .map((h) => h.id)
      .sort();

    // doc 1 ("Premium support included. Contact support for details.")
    // and doc 2 ("Basic support only.") both contain "support"; doc 3
    // does not. "support" stems to itself, so it's a fair query for both
    // the real stemming indexer and the Python generator's literal
    // tokenization.
    expect(tsHits).toEqual([1, 2]);
    expect(pyHits).toEqual([1, 2]);
  });

  it("both implementations rank the document with more matches first", async () => {
    const tsClient = new SearchClient({
      indexUrl: `${tsBaseUrl}manifest.json`,
    });
    const pyClient = new SearchClient({
      indexUrl: `${pyBaseUrl}manifest.json`,
    });

    // doc 1 matches "support" twice; doc 2 matches once -- true
    // regardless of field-boost differences between the two generators.
    const tsHits = (await tsClient.search("support")).hits;
    const pyHits = (await pyClient.search("support")).hits;
    expect(tsHits[0]?.id).toBe(1);
    expect(pyHits[0]?.id).toBe(1);
  });

  it("both implementations resolve a multi-term boolean-AND query to the same doc id", async () => {
    const tsClient = new SearchClient({
      indexUrl: `${tsBaseUrl}manifest.json`,
    });
    const pyClient = new SearchClient({
      indexUrl: `${pyBaseUrl}manifest.json`,
    });

    // Only doc 3 ("About Us" / "We are a small company that makes
    // things.") contains both "small" and "about"; both words stem to
    // themselves.
    const tsHits = (await tsClient.search("small about")).hits.map((h) => h.id);
    const pyHits = (await pyClient.search("small about")).hits.map((h) => h.id);
    expect(tsHits).toEqual([3]);
    expect(pyHits).toEqual([3]);
  });

  it("both implementations return no hits for a term absent from the corpus", async () => {
    const tsClient = new SearchClient({
      indexUrl: `${tsBaseUrl}manifest.json`,
    });
    const pyClient = new SearchClient({
      indexUrl: `${pyBaseUrl}manifest.json`,
    });

    expect((await tsClient.search("xyzzyquux")).hits).toEqual([]);
    expect((await pyClient.search("xyzzyquux")).hits).toEqual([]);
  });
});
