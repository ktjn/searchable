import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateCms2kCorpus } from "@csf/fixtures";
import type { TermShard } from "@csf/format";
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

  it("shards terms by first-character prefix, one shard per distinct leading character", async () => {
    // docA/docB's vocabulary (alpha, beta, shared, term, widget) has five
    // distinct leading characters, each producing its own tiny shard --
    // real per-first-character-prefix sharding
    // (docs/02-index-format.md#term-shard-inverted-index), not the single
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
    // exercising docs/02-index-format.md#size-targets--sharding-tuning's
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

  it("writes a single unsharded term shard per language when shardByPrefix:false (docs/14's small-corpus-mode recommendation)", async () => {
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
    // "shared" stems to "share" (docs/03-tokenization-i18n.md#stemming).
    expect(Object.keys(shard).sort()).toEqual([
      "alpha",
      "beta",
      "share",
      "term",
      "widget",
    ]);
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

    // "widgets" stems to "widget" (docs/03-tokenization-i18n.md#stemming),
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
