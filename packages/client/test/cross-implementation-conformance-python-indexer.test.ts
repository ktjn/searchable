import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Manifest } from "@ktjn/searchable-format";
import {
  buildIndex,
  discoverHtmlDocuments,
  writeIndex,
} from "@ktjn/searchable-indexer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SearchClient } from "../src/client.js";
import { serveStatic } from "./static-server.js";

/**
 * Cross-implementation conformance against the *real* Python
 * `searchable-indexer` CLI (python/searchable-indexer/), as opposed to
 * cross-implementation-conformance.test.ts's independent, from-scratch
 * `spec/examples/python/generate_index.py` generator. Where that test's
 * whole point is comparing the reference TS indexer against a minimal,
 * intentionally-non-conformant generator, this test's point is the
 * inverse: `searchable-indexer` (python/) is a from-scratch Python re-
 * implementation of `@ktjn/searchable-indexer` intended to be a conformant, drop-in
 * peer -- same manifest/shard format, same tokenization pipeline
 * (`searchable-analysis`, a Python port of `@ktjn/searchable-analysis`'s stemming/
 * segmentation). This test proves that claim by indexing the *same*
 * fixture corpus two ways -- `@ktjn/searchable-indexer`'s `buildIndex`/`writeIndex`,
 * and `uv run searchable-indexer <src> <out>` -- and running the *same*
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
const pythonIndexerDir = join(repoRoot, "python", "searchable-indexer");

interface FixtureSource {
  /** Filename stem (`${filename}.html`) -- also its sort key, since both discover functions assign doc ids by sorted-filename order (see the file-level doc comment). */
  filename: number;
  lang: string;
  title: string;
  body: string;
  /** Extra <meta name="..." content="..."> tags to inject into <head>, verbatim -- used by the facets/pins fixture doc (searchable-facet-<field>/searchable-pin, docs/reference/cms-meta-tags.md, docs/guides/pinning.md). Both discover functions parse these identically on the TS and Python sides. */
  meta?: { name: string; content: string }[];
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
  {
    filename: 4,
    lang: "en",
    title: "Gizmos",
    body: "Gizmos and gadgets for the modern home.",
    meta: [
      { name: "searchable-facet-category", content: "electronics" },
      { name: "searchable-pin", content: "gizmos" },
    ],
  },
];

function toHtml(source: FixtureSource): string {
  const metaTags = (source.meta ?? [])
    .map((m) => `<meta name="${m.name}" content="${m.content}">`)
    .join("");
  return `<html lang="${source.lang}"><head><title>${source.title}</title>${metaTags}</head><body><main><p>${source.body}</p></main></body></html>`;
}

describe("cross-implementation conformance: real searchable-indexer Python CLI", () => {
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
    srcDir = await mkdtemp(join(tmpdir(), "searchable-conformance-src-"));
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
    tsOutDir = await mkdtemp(join(tmpdir(), "searchable-conformance-ts-"));
    await writeIndex(buildIndex(sources, "en"), tsOutDir);
    const tsServer = await serveStatic(tsOutDir);
    tsBaseUrl = tsServer.baseUrl;
    closeTsServer = tsServer.close;

    // --- Python side: the real searchable-indexer CLI, run against the same
    // rendered-HTML fixture on disk ---
    pyOutDir = await mkdtemp(join(tmpdir(), "searchable-conformance-py-"));
    execFileSync("uv", ["run", "searchable-indexer", srcDir, pyOutDir], {
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

  it("returns the same facet counts and pin-boosted top hit for a query against both implementations", async () => {
    const tsClient = new SearchClient({
      indexUrl: `${tsBaseUrl}manifest.json`,
    });
    const pyClient = new SearchClient({
      indexUrl: `${pyBaseUrl}manifest.json`,
    });

    // "4.html" (the gizmos doc) is the only doc declaring
    // searchable-facet-category, so both implementations' facet shards agree
    // on a single "electronics" value with count 1.
    const tsFacets = await tsClient.facetValues("category");
    const pyFacets = await pyClient.facetValues("category");
    expect(pyFacets).toEqual(tsFacets);
    expect(tsFacets).toEqual({
      values: [{ value: "electronics", count: 1, selected: false }],
    });

    // "gizmos" (normalized/stemmed identically by both sides via
    // normalizePhrase()) is an exact-mode searchable-pin on 4.html only, even
    // though the word "gizmos" also appears organically in 2.html's
    // body -- a matching pin is placed ahead of organic hits
    // regardless of BM25 ranking, so both implementations must agree
    // the pinned doc (4.html) is the top hit.
    const tsResult = await tsClient.search("gizmos");
    const pyResult = await pyClient.search("gizmos");
    expect(pyResult.hits[0]?.id).toEqual(tsResult.hits[0]?.id);
    expect(tsResult.hits[0]?.pinned).toBe(true);
  });
});

/**
 * Byte-identical conformance for the binary storage tier
 * (docs/concepts/binary-storage.md):
 * unlike the JSON tier (where the two implementations only need to
 * agree on *content*), the binary term-shard/doc-store encoders are a
 * fully deterministic byte format (docs/archive/specs/binary-format.md) --
 * delta+varint postings, a fixed directory layout -- so there is no
 * legitimate source of byte-level divergence between a conformant TS
 * and Python encoder, unlike tokenization/stemming edge cases
 * elsewhere in this file. This block builds the *same* small,
 * hand-authored fixture on both sides (via `buildIndex`/`writeIndex`
 * directly on the TS side, and a small driver script invoking
 * `build_index`/`write_index` directly on the Python side, since the
 * Python CLI has no format flags), then asserts the raw shard bytes
 * are identical -- not just that a client can independently decode
 * both to the same content, though the second describe block above
 * already establishes that live-query equivalence for the JSON tier.
 *
 * A separate end-to-end query test (real HTTP + the real
 * `SearchClient`) proves the *decoder* side too: byte-identical output
 * is necessary but not sufficient, since a bug shared by both the TS
 * encoder and TS decoder could produce byte-identical-but-wrong shards
 * that still "worked" only because the same misencoding round-trips
 * through the same misdecoding. Querying the Python-built binary
 * output through `@ktjn/searchable-client`'s real binary decoder closes that gap.
 */
describe("cross-implementation conformance: binary storage tier byte-identity", () => {
  const FIXTURE = [
    {
      id: 0,
      url: "/a",
      html: '<html lang="en"><head><title>Widgets</title></head><body><main><p>Our widgets are wonderful and useful for everyone.</p></main></body></html>',
    },
    {
      id: 1,
      url: "/b",
      html: '<html lang="en"><head><title>Gadgets</title></head><body><main><p>Gadgets and gizmos for every home and office.</p></main></body></html>',
    },
  ];

  let tsOutDir: string;
  let pyOutDir: string;
  let pyBaseUrl: string;
  let closePyServer: () => Promise<void>;

  beforeAll(async () => {
    // --- TypeScript side: build the fixture in-memory and write it with the binary tier enabled ---
    tsOutDir = await mkdtemp(
      join(tmpdir(), "searchable-binary-conformance-ts-"),
    );
    const built = buildIndex(FIXTURE, "en");
    await writeIndex(built, tsOutDir, {
      termShardFormat: "binary",
      docStoreFormat: "binary",
    });

    // --- Python side: no CLI flags exist for the binary tier, so drive
    // build_index/write_index directly via a small script run through
    // `uv run python` from python/searchable-indexer/'s own venv. ---
    pyOutDir = await mkdtemp(
      join(tmpdir(), "searchable-binary-conformance-py-"),
    );
    const scriptDir = await mkdtemp(
      join(tmpdir(), "searchable-binary-conformance-script-"),
    );
    const scriptPath = join(scriptDir, "build_binary_fixture.py");
    await writeFile(
      scriptPath,
      [
        "import sys",
        "from searchable_indexer.build_index import build_index",
        "from searchable_indexer.write_index import write_index",
        "from searchable_indexer.types import SourceDocument",
        "",
        "sources = [",
        '    SourceDocument(id=0, url="/a", html=\'<html lang="en"><head><title>Widgets</title></head><body><main><p>Our widgets are wonderful and useful for everyone.</p></main></body></html>\'),',
        '    SourceDocument(id=1, url="/b", html=\'<html lang="en"><head><title>Gadgets</title></head><body><main><p>Gadgets and gizmos for every home and office.</p></main></body></html>\'),',
        "]",
        'built = build_index(sources, "en")',
        "write_index(",
        "    built,",
        "    sys.argv[1],",
        '    term_shard_format="binary",',
        '    doc_store_format="binary",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );
    execFileSync("uv", ["run", "python", scriptPath, pyOutDir], {
      cwd: pythonIndexerDir,
      stdio: "pipe",
    });
    await rm(scriptDir, { recursive: true, force: true });

    const pyServer = await serveStatic(pyOutDir);
    pyBaseUrl = pyServer.baseUrl;
    closePyServer = pyServer.close;
  });

  afterAll(async () => {
    await closePyServer();
    await Promise.all([
      rm(tsOutDir, { recursive: true, force: true }),
      rm(pyOutDir, { recursive: true, force: true }),
    ]);
  });

  it("produces byte-identical binary term-shard and doc-store files", () => {
    const tsManifest: Manifest = JSON.parse(
      readFileSync(join(tsOutDir, "manifest.json"), "utf8"),
    );
    const pyManifest: Manifest = JSON.parse(
      readFileSync(join(pyOutDir, "manifest.json"), "utf8"),
    );

    expect(tsManifest.shards.terms.length).toBeGreaterThan(0);
    expect(pyManifest.shards.terms.length).toEqual(
      tsManifest.shards.terms.length,
    );
    for (let i = 0; i < tsManifest.shards.terms.length; i++) {
      const tsEntry = tsManifest.shards.terms[i];
      const pyEntry = pyManifest.shards.terms[i];
      expect(tsEntry?.format).toBe("binary");
      expect(pyEntry?.format).toBe("binary");
      expect(pyEntry?.lang).toEqual(tsEntry?.lang);
      expect(pyEntry?.prefix).toEqual(tsEntry?.prefix);

      const tsBytes = readFileSync(join(tsOutDir, tsEntry?.file ?? ""));
      const pyBytes = readFileSync(join(pyOutDir, pyEntry?.file ?? ""));
      expect(pyBytes.equals(tsBytes)).toBe(true);
    }

    expect(tsManifest.shards.docs.length).toBeGreaterThan(0);
    expect(pyManifest.shards.docs.length).toEqual(
      tsManifest.shards.docs.length,
    );
    for (let i = 0; i < tsManifest.shards.docs.length; i++) {
      const tsEntry = tsManifest.shards.docs[i];
      const pyEntry = pyManifest.shards.docs[i];
      expect(tsEntry?.format).toBe("binary");
      expect(pyEntry?.format).toBe("binary");

      const tsBytes = readFileSync(join(tsOutDir, tsEntry?.file ?? ""));
      const pyBytes = readFileSync(join(pyOutDir, pyEntry?.file ?? ""));
      expect(pyBytes.equals(tsBytes)).toBe(true);
    }
  });

  it("lets the real SearchClient query the Python-built binary output over real HTTP", async () => {
    const pyClient = new SearchClient({
      indexUrl: `${pyBaseUrl}manifest.json`,
    });

    // "wonderful" appears only in the widgets doc (id 0) and stems to
    // itself under Porter stemming, so it's an unambiguous literal
    // query word regardless of which side's stemmer produced the
    // corpus (see the file-level doc comment on the block above for
    // why that matters).
    const result = await pyClient.search("wonderful");
    expect(result.hits.map((h) => h.id)).toEqual([0]);
  });
});
