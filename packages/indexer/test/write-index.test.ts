import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateCms2kCorpus } from "@ktjn/searchable-fixtures";
import type { TermShard } from "@ktjn/searchable-format";
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

interface TermsManifestEntry {
  lang: string;
  prefix: string;
  file: string;
  termCount: number;
}

/** Reads manifest.json and returns the term shard entry for (lang, prefix), or undefined if no such shard was written. */
async function findTermShardEntry(
  outDir: string,
  lang: string,
  prefix: string,
): Promise<TermsManifestEntry | undefined> {
  const manifest = JSON.parse(
    await readFile(join(outDir, "manifest.json"), "utf8"),
  );
  return (manifest.shards.terms as TermsManifestEntry[]).find(
    (s) => s.lang === lang && s.prefix === prefix,
  );
}

async function readTermShard(
  outDir: string,
  lang: string,
  prefix: string,
): Promise<TermShard> {
  const entry = await findTermShardEntry(outDir, lang, prefix);
  if (!entry) {
    throw new Error(`no term shard found for lang=${lang} prefix=${prefix}`);
  }
  return JSON.parse(await readFile(join(outDir, entry.file), "utf8"));
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
    <meta name="searchable-facet-category" content="shared"></head>
    <body><main><p>alpha widgets shared term</p></main></body></html>`,
};
const docB: SourceDocument = {
  id: 2,
  url: "/beta",
  html: `<html lang="en"><head><title>Beta</title>
    <meta name="searchable-facet-category" content="shared"></head>
    <body><main><p>beta widgets shared term</p></main></body></html>`,
};

describe("writeIndex", () => {
  it("does not mutate the BuiltIndex object passed in", async () => {
    const built = buildIndex([docA, docB]);
    const before = JSON.parse(JSON.stringify(built.manifest));

    await writeIndex(built, await tempOutDir());

    expect(built.manifest).toEqual(before);
  });

  it("shards terms by first-character prefix, one shard per distinct leading character", async () => {
    // docA/docB's vocabulary (alpha, beta, shared, term, widget) has five
    // distinct leading characters, each producing its own tiny shard --
    // real per-first-character-prefix sharding
    // (docs/concepts/index-format.md#term-shard-inverted-index), not the single
    // unsharded "terms/en/all.json" Phase 1 originally shipped.
    const built = buildIndex([docA, docB]);
    const outDir = await tempOutDir();
    await writeIndex(built, outDir);

    const manifest = JSON.parse(
      await readFile(join(outDir, "manifest.json"), "utf8"),
    );
    const enShards = (
      manifest.shards.terms as {
        lang: string;
        prefix: string;
        termCount: number;
      }[]
    )
      .filter((s) => s.lang === "en")
      .sort((a, b) => a.prefix.localeCompare(b.prefix));
    expect(enShards.map((s) => s.prefix)).toEqual(["a", "b", "s", "t", "w"]);
    expect(enShards.every((s) => s.termCount === 1)).toBe(true);

    // "widget" (from "widgets") only lives in the "w" shard.
    const wShard = await readTermShard(outDir, "en", "w");
    expect(Object.keys(wShard)).toEqual(["widget"]);
  });

  it("auto-splits an over-budget one-character prefix bucket into two-character buckets", async () => {
    // Two distinct real terms sharing a leading character ("widget",
    // "wombat") would normally land in one "w" shard; forcing the gzip
    // byte budget down to 1 byte guarantees it's always "over budget",
    // exercising docs/concepts/index-format.md#size-targets-and-sharding-tuning's
    // "auto-increases prefix length ... for over-large shards" without
    // needing a corpus large enough to hit a real 50KB shard.
    const docs: SourceDocument[] = [
      {
        id: 1,
        url: "/item-1",
        html: `<html lang="en"><head><title>First</title></head><body><main><p>widget</p></main></body></html>`,
      },
      {
        id: 2,
        url: "/item-2",
        html: `<html lang="en"><head><title>Second</title></head><body><main><p>wombat</p></main></body></html>`,
      },
    ];
    const outDir = await tempOutDir();
    await writeIndex(buildIndex(docs), outDir, { maxShardGzipBytes: 1 });

    const manifest = JSON.parse(
      await readFile(join(outDir, "manifest.json"), "utf8"),
    );
    const enPrefixes = (
      manifest.shards.terms as { lang: string; prefix: string }[]
    )
      .filter((s) => s.lang === "en")
      .map((s) => s.prefix)
      .sort();
    // The forced-tiny budget splits every one-character bucket, not just
    // "w" -- the relevant assertion is that "widget"/"wombat" no longer
    // share one "w" bucket, each getting its own two-character one.
    expect(enPrefixes).not.toContain("w");
    expect(enPrefixes).toContain("wi");
    expect(enPrefixes).toContain("wo");

    const wiShard = await readTermShard(outDir, "en", "wi");
    expect(Object.keys(wiShard)).toEqual(["widget"]);
    const woShard = await readTermShard(outDir, "en", "wo");
    expect(Object.keys(woShard)).toEqual(["wombat"]);
  });

  it("every term in a shard actually starts with that shard's own prefix", async () => {
    // A broader, more realistic vocabulary than docA/docB's five words --
    // a structural invariant check across many shards/prefixes, not just
    // the hand-picked cases above.
    const sources = generateCms2kCorpus({ count: 50, languages: ["en"] });
    const built = buildIndex(sources);
    const outDir = await tempOutDir();
    await writeIndex(built, outDir);

    const manifest = JSON.parse(
      await readFile(join(outDir, "manifest.json"), "utf8"),
    );
    const enShardEntries = (
      manifest.shards.terms as { lang: string; prefix: string; file: string }[]
    ).filter((s) => s.lang === "en");
    expect(enShardEntries.length).toBeGreaterThan(1);

    for (const entry of enShardEntries) {
      const shard = JSON.parse(
        await readFile(join(outDir, entry.file), "utf8"),
      );
      for (const term of Object.keys(shard)) {
        expect(term.startsWith(entry.prefix)).toBe(true);
      }
    }
  });

  it("writes a single unsharded term shard per language when shardByPrefix:false (docs/guides/indexing.md's small-corpus-mode recommendation)", async () => {
    const built = buildIndex([docA, docB]);
    const outDir = await tempOutDir();
    await writeIndex(built, outDir, { shardByPrefix: false });

    const manifest = JSON.parse(
      await readFile(join(outDir, "manifest.json"), "utf8"),
    );
    const enShards = (
      manifest.shards.terms as {
        lang: string;
        prefix: string;
        termCount: number;
      }[]
    ).filter((s) => s.lang === "en");
    expect(enShards).toHaveLength(1);
    expect(enShards[0]).toMatchObject({
      lang: "en",
      prefix: "all",
      termCount: 5,
    });

    const shard = await readTermShard(outDir, "en", "all");
    // "shared" stems to "share" (docs/guides/internationalization.md#stemming).
    expect(Object.keys(shard).sort()).toEqual([
      "alpha",
      "beta",
      "share",
      "term",
      "widget",
    ]);
  });

  it("writes .bin files with format: 'binary' recorded per shard entry when termShardFormat: 'binary'", async () => {
    // Full decode-correctness (does a binary shard actually round-trip
    // through a real client and return identical search results to the
    // JSON equivalent) is proven end-to-end in
    // packages/client/test/binary-term-shard.test.ts, which has both
    // the encoder (this package) and the decoder (@ktjn/searchable-client)
    // available -- this test only checks the structural contract
    // writeIndex() itself owns: file extension and manifest entries.
    const built = buildIndex([docA, docB]);
    const outDir = await tempOutDir();
    await writeIndex(built, outDir, { termShardFormat: "binary" });

    const manifest = JSON.parse(
      await readFile(join(outDir, "manifest.json"), "utf8"),
    );
    const enShards = (
      manifest.shards.terms as {
        lang: string;
        prefix: string;
        file: string;
        format?: string;
      }[]
    ).filter((s) => s.lang === "en");
    expect(enShards.length).toBeGreaterThan(0);
    for (const entry of enShards) {
      expect(entry.format).toBe("binary");
      expect(entry.file).toMatch(/\.bin$/);
    }
  });

  it("produces byte-identical binary term shards regardless of source document order", async () => {
    const outDir1 = await tempOutDir();
    const outDir2 = await tempOutDir();

    await writeIndex(buildIndex([docA, docB]), outDir1, {
      termShardFormat: "binary",
    });
    await writeIndex(buildIndex([docB, docA]), outDir2, {
      termShardFormat: "binary",
    });

    const termsFiles1 = (await readdir(join(outDir1, "terms", "en"))).sort();
    const termsFiles2 = (await readdir(join(outDir2, "terms", "en"))).sort();
    expect(termsFiles1).toEqual(termsFiles2); // same content hash in filename, per shard

    for (const [i, file] of termsFiles1.entries()) {
      const content1 = await readFile(join(outDir1, "terms", "en", file));
      const content2 = await readFile(
        join(outDir2, "terms", "en", termsFiles2[i] as string),
      );
      expect(content1.equals(content2)).toBe(true);
    }
  });

  it("produces byte-identical term and facet shards regardless of source document order", async () => {
    const outDir1 = await tempOutDir();
    const outDir2 = await tempOutDir();

    await writeIndex(buildIndex([docA, docB]), outDir1);
    await writeIndex(buildIndex([docB, docA]), outDir2);

    const termsFiles1 = (await readdir(join(outDir1, "terms", "en"))).sort();
    const termsFiles2 = (await readdir(join(outDir2, "terms", "en"))).sort();
    expect(termsFiles1).toEqual(termsFiles2); // same content hash in filename, per shard

    for (const [i, file] of termsFiles1.entries()) {
      const content1 = await readFile(
        join(outDir1, "terms", "en", file),
        "utf8",
      );
      const content2 = await readFile(
        join(outDir2, "terms", "en", termsFiles2[i] as string),
        "utf8",
      );
      expect(content1).toBe(content2);
    }

    const facetFiles1 = await readdir(join(outDir1, "facets"));
    const facetFiles2 = await readdir(join(outDir2, "facets"));
    expect(facetFiles1).toEqual(facetFiles2);
  });

  it("sorts postings within a term entry by doc id, independent of processing order", async () => {
    const outDir = await tempOutDir();
    // docB processed before docA -- postings should still come out doc-id-ascending.
    const built = buildIndex([docB, docA]);
    await writeIndex(built, outDir);

    // "widgets" stems to "widget" (docs/guides/internationalization.md#stemming),
    // which lives in the "w" shard.
    const content = await readTermShard(outDir, "en", "w");
    expect(content.widget?.postings.map((p) => p.doc)).toEqual([1, 2]);
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
          <meta name="searchable-facet-range-price" content="29.99"></head>
          <body><main>a</main></body></html>`,
      },
      {
        id: 2,
        url: "/b",
        html: `<html lang="en"><head><title>B</title>
          <meta name="searchable-facet-range-price" content="9.5"></head>
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

  it("writes a synonyms shard for a language with only multiWord data (not just equivalences/directional)", async () => {
    const outDir = await tempOutDir();
    const built = buildIndex([docA], "en", {
      synonyms: { en: { multiWord: [["new york", "nyc"]] } },
    });
    await writeIndex(built, outDir);

    const manifest = JSON.parse(
      await readFile(join(outDir, "manifest.json"), "utf8"),
    );
    expect(manifest.synonyms.en).toMatch(/^synonyms\/en\.[0-9a-f]+\.json$/);

    const content = JSON.parse(
      await readFile(join(outDir, manifest.synonyms.en), "utf8"),
    );
    expect(content.multiWord).toEqual([["new york", "nyc"]]);
  });

  it("writes a fuzzy shard and records it in the manifest when fuzzy:true", async () => {
    const outDir = await tempOutDir();
    const built = buildIndex([docA], "en", { fuzzy: true });
    await writeIndex(built, outDir);

    const manifest = JSON.parse(
      await readFile(join(outDir, "manifest.json"), "utf8"),
    );
    expect(manifest.fuzzy.en.file).toMatch(/^fuzzy\/en\.[0-9a-f]+\.json$/);
    expect(manifest.fuzzy.en.format).toBeUndefined();

    const content = JSON.parse(
      await readFile(join(outDir, manifest.fuzzy.en.file), "utf8"),
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

  it("writes a .bin fuzzy shard with format: 'binary' recorded when fuzzyShardFormat: 'binary'", async () => {
    // Full decode-correctness is proven end-to-end in
    // packages/client/test/binary-fuzzy-shard.test.ts -- same split of
    // responsibility as the term shard's own structural-only test above.
    const outDir = await tempOutDir();
    const built = buildIndex([docA], "en", { fuzzy: true });
    await writeIndex(built, outDir, { fuzzyShardFormat: "binary" });

    const manifest = JSON.parse(
      await readFile(join(outDir, "manifest.json"), "utf8"),
    );
    expect(manifest.fuzzy.en.format).toBe("binary");
    expect(manifest.fuzzy.en.file).toMatch(/^fuzzy\/en\.[0-9a-f]+\.bin$/);
  });

  it("produces byte-identical binary fuzzy shards regardless of source document order", async () => {
    const outDir1 = await tempOutDir();
    const outDir2 = await tempOutDir();
    await writeIndex(buildIndex([docA, docB], "en", { fuzzy: true }), outDir1, {
      fuzzyShardFormat: "binary",
    });
    await writeIndex(buildIndex([docB, docA], "en", { fuzzy: true }), outDir2, {
      fuzzyShardFormat: "binary",
    });

    const manifest1 = JSON.parse(
      await readFile(join(outDir1, "manifest.json"), "utf8"),
    );
    const manifest2 = JSON.parse(
      await readFile(join(outDir2, "manifest.json"), "utf8"),
    );
    expect(manifest1.fuzzy.en.file).toBe(manifest2.fuzzy.en.file);

    const content1 = await readFile(join(outDir1, manifest1.fuzzy.en.file));
    const content2 = await readFile(join(outDir2, manifest2.fuzzy.en.file));
    expect(content1.equals(content2)).toBe(true);
  });

  it("writes a .bin doc store with format: 'binary' recorded when docStoreFormat: 'binary'", async () => {
    // Full decode-correctness is proven end-to-end in
    // packages/client/test/binary-doc-store.test.ts.
    const outDir = await tempOutDir();
    const built = buildIndex([docA, docB]);
    await writeIndex(built, outDir, { docStoreFormat: "binary" });

    const manifest = JSON.parse(
      await readFile(join(outDir, "manifest.json"), "utf8"),
    );
    expect(manifest.shards.docs).toHaveLength(1);
    expect(manifest.shards.docs[0].format).toBe("binary");
    expect(manifest.shards.docs[0].file).toMatch(/^docs\/0\.[0-9a-f]+\.bin$/);
  });

  it("produces a byte-identical binary doc store regardless of source document order", async () => {
    const outDir1 = await tempOutDir();
    const outDir2 = await tempOutDir();
    await writeIndex(buildIndex([docA, docB]), outDir1, {
      docStoreFormat: "binary",
    });
    await writeIndex(buildIndex([docB, docA]), outDir2, {
      docStoreFormat: "binary",
    });

    const manifest1 = JSON.parse(
      await readFile(join(outDir1, "manifest.json"), "utf8"),
    );
    const manifest2 = JSON.parse(
      await readFile(join(outDir2, "manifest.json"), "utf8"),
    );
    expect(manifest1.shards.docs[0].file).toBe(manifest2.shards.docs[0].file);

    const content1 = await readFile(
      join(outDir1, manifest1.shards.docs[0].file),
    );
    const content2 = await readFile(
      join(outDir2, manifest2.shards.docs[0].file),
    );
    expect(content1.equals(content2)).toBe(true);
  });

  it("writes exactly one doc-store shard by default, regardless of corpus size (issue #1 finding 6)", async () => {
    const outDir = await tempOutDir();
    const sources = generateCms2kCorpus({ count: 50, languages: ["en"] });
    await writeIndex(buildIndex(sources, "en"), outDir);
    const manifest = JSON.parse(
      await readFile(join(outDir, "manifest.json"), "utf8"),
    );
    expect(manifest.shards.docs).toHaveLength(1);
  });

  it("docStoreShardSize splits the doc store into multiple contiguous id-range shards", async () => {
    const outDir = await tempOutDir();
    const sources = generateCms2kCorpus({ count: 50, languages: ["en"] });
    await writeIndex(buildIndex(sources, "en"), outDir, {
      docStoreShardSize: 20,
    });
    const manifest = JSON.parse(
      await readFile(join(outDir, "manifest.json"), "utf8"),
    );
    const maxId = Math.max(...sources.map((s) => s.id));
    expect(manifest.shards.docs).toHaveLength(Math.ceil(maxId / 20));

    const idRanges = manifest.shards.docs
      .map((d: { idRange: [number, number] }) => d.idRange)
      .sort((a: [number, number], b: [number, number]) => a[0] - b[0]);
    // Contiguous, non-overlapping, and covering every id 1..maxId with no gaps.
    expect(idRanges[0][0]).toBe(1);
    expect(idRanges[idRanges.length - 1][1]).toBe(maxId);
    for (let i = 1; i < idRanges.length; i++) {
      expect(idRanges[i][0]).toBe(idRanges[i - 1][1] + 1);
    }
  });

  it("each JSON doc-store shard's ids exactly match its declared idRange, no gaps or overlaps", async () => {
    // Binary-format decode-correctness for a multi-shard doc store is
    // proven end-to-end in packages/client/test/binary-doc-store.test.ts
    // (same split as the single-shard "writes a .bin doc store" case
    // above -- @ktjn/searchable-client owns the binary decoder, not this package).
    const outDir = await tempOutDir();
    const sources = generateCms2kCorpus({ count: 30, languages: ["en"] });
    await writeIndex(buildIndex(sources, "en"), outDir, {
      docStoreShardSize: 10,
    });
    const manifest = JSON.parse(
      await readFile(join(outDir, "manifest.json"), "utf8"),
    );
    const maxId = Math.max(...sources.map((s) => s.id));
    expect(manifest.shards.docs).toHaveLength(Math.ceil(maxId / 10));

    for (const entry of manifest.shards.docs as Array<{
      file: string;
      idRange: [number, number];
    }>) {
      const shard = JSON.parse(
        await readFile(join(outDir, entry.file), "utf8"),
      );
      const ids = Object.keys(shard)
        .map(Number)
        .sort((a, b) => a - b);
      expect(ids[0]).toBe(entry.idRange[0]);
      expect(ids[ids.length - 1]).toBe(entry.idRange[1]);
      expect(ids).toHaveLength(entry.idRange[1] - entry.idRange[0] + 1);
    }
  });

  it("still writes exactly one, empty doc-store shard for a corpus where every document is searchable-noindex", async () => {
    const outDir = await tempOutDir();
    const noindexOnly: SourceDocument = {
      id: 1,
      url: "/draft",
      html: `<html lang="en"><head><title>Draft</title><meta name="searchable-noindex"></head><body><main>x</main></body></html>`,
    };
    await writeIndex(buildIndex([noindexOnly]), outDir, {
      docStoreShardSize: 5,
    });
    const manifest = JSON.parse(
      await readFile(join(outDir, "manifest.json"), "utf8"),
    );
    expect(manifest.shards.docs).toHaveLength(1);
    const shard = JSON.parse(
      await readFile(join(outDir, manifest.shards.docs[0].file), "utf8"),
    );
    expect(shard).toEqual({});
  });
});
