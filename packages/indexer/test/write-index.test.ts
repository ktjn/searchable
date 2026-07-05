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
    expect(content.widgets.postings.map((p: { doc: number }) => p.doc)).toEqual(
      [1, 2],
    );
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
});
