import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildIndex } from "../src/build-index.js";
import type { SourceDocument } from "../src/types.js";
import { writeIndex } from "../src/write-index.js";

const outDirs: string[] = [];
async function tempOutDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "csf-write-index-"));
  outDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    outDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

const docA: SourceDocument = {
  id: 1,
  url: "/alpha",
  html: `<html lang="en"><head><title>Alpha</title>
    <meta name="csf-facet-category" content="shared"></head>
    <body><main><p>alpha widgets shared term</p></main></body></html>`,
};
const docB: SourceDocument = {
  id: 2,
  url: "/beta",
  html: `<html lang="en"><head><title>Beta</title>
    <meta name="csf-facet-category" content="shared"></head>
    <body><main><p>beta widgets shared term</p></main></body></html>`,
};

describe("writeIndex", () => {
  it("does not mutate the BuiltIndex object passed in", async () => {
    const built = buildIndex([docA, docB]);
    const before = JSON.parse(JSON.stringify(built.manifest));

    await writeIndex(built, await tempOutDir());

    expect(built.manifest).toEqual(before);
  });

  it("produces byte-identical term and facet shards regardless of source document order", async () => {
    const outDir1 = await tempOutDir();
    const outDir2 = await tempOutDir();

    await writeIndex(buildIndex([docA, docB]), outDir1);
    await writeIndex(buildIndex([docB, docA]), outDir2);

    const termsFiles1 = await readdir(join(outDir1, "terms", "en"));
    const termsFiles2 = await readdir(join(outDir2, "terms", "en"));
    expect(termsFiles1).toEqual(termsFiles2); // same content hash in filename

    const termsContent1 = await readFile(
      join(outDir1, "terms", "en", termsFiles1[0] as string),
      "utf8",
    );
    const termsContent2 = await readFile(
      join(outDir2, "terms", "en", termsFiles2[0] as string),
      "utf8",
    );
    expect(termsContent1).toBe(termsContent2);

    const facetFiles1 = await readdir(join(outDir1, "facets"));
    const facetFiles2 = await readdir(join(outDir2, "facets"));
    expect(facetFiles1).toEqual(facetFiles2);
  });

  it("sorts postings within a term entry by doc id, independent of processing order", async () => {
    const outDir = await tempOutDir();
    // docB processed before docA -- postings should still come out doc-id-ascending.
    const built = buildIndex([docB, docA]);
    await writeIndex(built, outDir);

    const termsFiles = await readdir(join(outDir, "terms", "en"));
    const content = JSON.parse(
      await readFile(
        join(outDir, "terms", "en", termsFiles[0] as string),
        "utf8",
      ),
    );
    // "widgets" stems to "widget" (docs/03-tokenization-i18n.md#stemming).
    expect(content.widget.postings.map((p: { doc: number }) => p.doc)).toEqual([
      1, 2,
    ]);
  });

  it("sorts facet value doc-id lists ascending, independent of processing order", async () => {
    const outDir = await tempOutDir();
    const built = buildIndex([docB, docA]);
    await writeIndex(built, outDir);

    const facetFiles = await readdir(join(outDir, "facets"));
    const content = JSON.parse(
      await readFile(join(outDir, "facets", facetFiles[0] as string), "utf8"),
    );
    expect(content.values.shared.docs).toEqual([1, 2]);
  });

  it("writes a range facet shard's sorted (value, doc) array to disk intact", async () => {
    const outDir = await tempOutDir();
    const rangeDocs = [
      {
        id: 1,
        url: "/a",
        html: `<html lang="en"><head><title>A</title>
          <meta name="csf-facet-range-price" content="29.99"></head>
          <body><main>a</main></body></html>`,
      },
      {
        id: 2,
        url: "/b",
        html: `<html lang="en"><head><title>B</title>
          <meta name="csf-facet-range-price" content="9.5"></head>
          <body><main>b</main></body></html>`,
      },
    ];
    const built = buildIndex(rangeDocs);
    await writeIndex(built, outDir);

    const facetFiles = await readdir(join(outDir, "facets"));
    const content = JSON.parse(
      await readFile(join(outDir, "facets", facetFiles[0] as string), "utf8"),
    );
    expect(content.type).toBe("range");
    expect(content.sorted).toEqual([
      { value: 9.5, doc: 2 },
      { value: 29.99, doc: 1 },
    ]);
  });

  it("writes a synonyms shard and records it in the manifest, only for languages with data", async () => {
    const outDir = await tempOutDir();
    const built = buildIndex([docA], "en", {
      synonyms: { en: { equivalences: [["widgets", "gadgets"]] } },
    });
    await writeIndex(built, outDir);

    const manifest = JSON.parse(
      await readFile(join(outDir, "manifest.json"), "utf8"),
    );
    expect(manifest.synonyms.en).toMatch(/^synonyms\/en\.[0-9a-f]+\.json$/);

    const content = JSON.parse(
      await readFile(join(outDir, manifest.synonyms.en), "utf8"),
    );
    expect(content.equivalences).toEqual([["widget", "gadget"]]);
  });

  it("omits manifest.synonyms entirely when no synonym data was authored", async () => {
    const outDir = await tempOutDir();
    await writeIndex(buildIndex([docA]), outDir);

    const manifest = JSON.parse(
      await readFile(join(outDir, "manifest.json"), "utf8"),
    );
    expect(manifest.synonyms).toBeUndefined();
  });

  it("writes a fuzzy shard and records it in the manifest when fuzzy:true", async () => {
    const outDir = await tempOutDir();
    const built = buildIndex([docA], "en", { fuzzy: true });
    await writeIndex(built, outDir);

    const manifest = JSON.parse(
      await readFile(join(outDir, "manifest.json"), "utf8"),
    );
    expect(manifest.fuzzy.en).toMatch(/^fuzzy\/en\.[0-9a-f]+\.json$/);

    const content = JSON.parse(
      await readFile(join(outDir, manifest.fuzzy.en), "utf8"),
    );
    expect(content.maxEdits).toBe(1);
    // "widgets" stems to the real indexed term "widget"; "widge" (drop
    // the trailing "t") is one of its one-character-deleted variants.
    expect(content.deletions.widge).toContain("widget");
  });

  it("omits manifest.fuzzy entirely when fuzzy was not requested", async () => {
    const outDir = await tempOutDir();
    await writeIndex(buildIndex([docA]), outDir);

    const manifest = JSON.parse(
      await readFile(join(outDir, "manifest.json"), "utf8"),
    );
    expect(manifest.fuzzy).toBeUndefined();
  });
});
