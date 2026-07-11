import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex, discoverHtmlDocuments, writeIndex } from "@csf/indexer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SearchClient } from "../src/client.js";
import { serveStatic } from "./static-server.js";

/**
 * Cross-implementation conformance against the *real* Python
 * `csf-indexer` CLI (python/csf-indexer/), as opposed to
 * cross-implementation-conformance.test.ts's independent, from-scratch
 * `spec/examples/python/generate_index.py` generator. Where that test's
 * whole point is comparing the reference TS indexer against a minimal,
 * intentionally-non-conformant generator, this test's point is the
 * inverse: `csf-indexer` (python/) is a from-scratch Python re-
 * implementation of `@csf/indexer` intended to be a conformant, drop-in
 * peer -- same manifest/shard format, same tokenization pipeline
 * (`csf-analysis`, a Python port of `@csf/analysis`'s stemming/
 * segmentation). This test proves that claim by indexing the *same*
 * fixture corpus two ways -- `@csf/indexer`'s `buildIndex`/`writeIndex`,
 * and `uv run csf-indexer <src> <out>` -- and running the *same*
 * end-to-end query assertions against both outputs over real HTTP via
 * the real `SearchClient`.
 *
 * As in cross-implementation-conformance.test.ts: `SearchClient`
 * always runs the real TS stemmer during query analysis regardless of
 * which backend built the index, so a query word only produces the
 * same lookup key against *both* outputs if its stem equals its own
 * surface form. The fixture text/query words below were chosen with
 * that in mind ("widgets" stems to "widget" under Porter stemming and
 * is deliberately avoided as a *query* word -- see the English test's
 * comment).
 *
 * Both sides discover the *same* fixture directory on disk (rather
 * than the TS side building from an in-memory `SourceDocument[]` with
 * hand-picked ids) so that doc-id assignment is identical on both
 * sides: both `discoverHtmlDocuments` (TS, discover.ts) and
 * `discover_html_documents` (Python, discover.py) assign ids by
 * sorted-filename enumeration order, not by any id embedded in the
 * fixture. Comparing a hand-assigned TS id against the CLI's
 * discovery-order id would be an apples-to-oranges mismatch having
 * nothing to do with conformance.
 */

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const pythonIndexerDir = join(repoRoot, "python", "csf-indexer");

interface FixtureSource {
  /** Filename stem (`${filename}.html`) -- also its sort key, since both discover functions assign doc ids by sorted-filename order (see the file-level doc comment). */
  filename: number;
  lang: string;
  title: string;
  body: string;
}

const FIXTURE_SOURCES: FixtureSource[] = [
  {
    filename: 1,
    lang: "en",
    title: "Widgets",
    body: "Our widgets are wonderful and useful for everyone.",
  },
  {
    filename: 2,
    lang: "en",
    title: "Gadgets",
    body: "Gadgets and gizmos for every home and office.",
  },
  {
    filename: 3,
    lang: "de",
    title: "Sofas",
    body: "Unsere Sofas sind sehr bequem und gross.",
  },
];

function toHtml(source: FixtureSource): string {
  return `<html lang="${source.lang}"><head><title>${source.title}</title></head><body><main><p>${source.body}</p></main></body></html>`;
}

describe("cross-implementation conformance: real csf-indexer Python CLI", () => {
  let tsBaseUrl: string;
  let closeTsServer: () => Promise<void>;
  let tsOutDir: string;

  let pyBaseUrl: string;
  let closePyServer: () => Promise<void>;
  let pyOutDir: string;
  let srcDir: string;

  beforeAll(async () => {
    // Write the fixture corpus to disk once; both sides discover it
    // from the same directory so doc-id assignment (sorted-filename
    // enumeration order, on both the TS and Python discover
    // functions) is identical for both.
    srcDir = await mkdtemp(join(tmpdir(), "csf-conformance-src-"));
    await mkdir(srcDir, { recursive: true });
    for (const source of FIXTURE_SOURCES) {
      await writeFile(
        join(srcDir, `${source.filename}.html`),
        toHtml(source),
        "utf8",
      );
    }

    // --- TypeScript side: the real reference indexer ---
    const sources = await discoverHtmlDocuments(srcDir);
    tsOutDir = await mkdtemp(join(tmpdir(), "csf-conformance-ts-"));
    await writeIndex(buildIndex(sources, "en"), tsOutDir);
    const tsServer = await serveStatic(tsOutDir);
    tsBaseUrl = tsServer.baseUrl;
    closeTsServer = tsServer.close;

    // --- Python side: the real csf-indexer CLI, run against the same
    // rendered-HTML fixture on disk ---
    pyOutDir = await mkdtemp(join(tmpdir(), "csf-conformance-py-"));
    execFileSync("uv", ["run", "csf-indexer", srcDir, pyOutDir], {
      cwd: pythonIndexerDir,
      stdio: "pipe",
    });
    const pyServer = await serveStatic(pyOutDir);
    pyBaseUrl = pyServer.baseUrl;
    closePyServer = pyServer.close;
  });

  afterAll(async () => {
    await Promise.all([closeTsServer(), closePyServer()]);
    await Promise.all([
      rm(tsOutDir, { recursive: true, force: true }),
      rm(pyOutDir, { recursive: true, force: true }),
      rm(srcDir, { recursive: true, force: true }),
    ]);
  });

  it("returns the same matching doc ids for an English query against both implementations", async () => {
    const tsClient = new SearchClient({
      indexUrl: `${tsBaseUrl}manifest.json`,
    });
    const pyClient = new SearchClient({
      indexUrl: `${pyBaseUrl}manifest.json`,
    });

    // "wonderful" (the widgets doc only) stems to itself under Porter
    // stemming, so it's a fair literal-string query against both a TS-stemmed
    // and a Python-stemmed index -- unlike "widgets", which stems to
    // "widget" and would only be a fair query if both sides applied
    // the exact same stemmer to the *query itself* as well as the
    // corpus (which `SearchClient` does, but this test wants to keep
    // the query word choice unambiguous regardless).
    const tsIds = (await tsClient.search("wonderful")).hits
      .map((h) => h.id)
      .sort();
    const pyIds = (await pyClient.search("wonderful")).hits
      .map((h) => h.id)
      .sort();

    expect(pyIds).toEqual(tsIds);
    // "1.html" (the widgets doc) sorts first, so both sides assign it
    // doc id 0.
    expect(tsIds).toEqual([0]);
  });

  it("returns the same matching doc ids for a German query against both implementations", async () => {
    const tsClient = new SearchClient({
      indexUrl: `${tsBaseUrl}manifest.json`,
    });
    const pyClient = new SearchClient({
      indexUrl: `${pyBaseUrl}manifest.json`,
    });

    // "sofas" (the sofas doc only) stems to itself under German
    // Snowball stemming.
    const tsIds = (await tsClient.search("sofas", { language: "de" })).hits
      .map((h) => h.id)
      .sort();
    const pyIds = (await pyClient.search("sofas", { language: "de" })).hits
      .map((h) => h.id)
      .sort();

    expect(pyIds).toEqual(tsIds);
    // "3.html" (the sofas doc) sorts last, so both sides assign it
    // doc id 2.
    expect(tsIds).toEqual([2]);
  });
});
