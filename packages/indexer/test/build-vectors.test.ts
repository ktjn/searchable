import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VectorShard } from "@csf/format";
import { afterEach, describe, expect, it } from "vitest";
import { buildIndex } from "../src/build-index.js";
import { buildVectorShards } from "../src/build-vectors.js";
import type { SourceDocument } from "../src/types.js";
import { writeIndex } from "../src/write-index.js";

const outDirs: string[] = [];
async function tempOutDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "csf-build-vectors-"));
  outDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    outDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

/** Deterministic, test-only embedder: 3 dims, one per document -- lets each test assert exact expected vectors without depending on any real model. */
function fixedDimEmbed(texts: string[]): number[][] {
  return texts.map((text) => [text.length, text.split(" ").length, 1]);
}

const sources: SourceDocument[] = [
  {
    id: 1,
    url: "/en-1",
    html: `<html lang="en"><head><title>Widgets</title></head><body><main><p>Our widgets are wonderful and useful.</p></main></body></html>`,
  },
  {
    id: 2,
    url: "/en-2",
    html: `<html lang="en"><head><title>Gadgets</title></head><body><main><p>Gadgets and gizmos for everyone.</p></main></body></html>`,
  },
  {
    id: 3,
    url: "/de-1",
    html: `<html lang="de"><head><title>Sofas</title></head><body><main><p>Unsere Sofas sind sehr bequem.</p></main></body></html>`,
  },
  {
    id: 4,
    url: "/noindex",
    html: `<html lang="en"><head><title>Hidden</title><meta name="csf-noindex" content="true"></head><body><main><p>Should never be embedded.</p></main></body></html>`,
  },
];

describe("buildVectorShards", () => {
  it("partitions chunks by each document's own language, one shard per language", async () => {
    const built = await buildVectorShards(sources, "en", {
      embed: fixedDimEmbed,
      quantization: "float32",
    });
    expect(Object.keys(built.shardsByLanguage).sort()).toEqual(["de", "en"]);
    expect(
      built.shardsByLanguage.en?.entries.map((e) => e.docId).sort(),
    ).toEqual([1, 2]);
    expect(built.shardsByLanguage.de?.entries.map((e) => e.docId)).toEqual([3]);
  });

  it("skips csf-noindex documents, same as buildIndex", async () => {
    const built = await buildVectorShards(sources, "en", {
      embed: fixedDimEmbed,
      quantization: "float32",
    });
    const allDocIds = Object.values(built.shardsByLanguage).flatMap((s) =>
      s.entries.map((e) => e.docId),
    );
    expect(allDocIds).not.toContain(4);
  });

  it("produces passageId as `${docId}-${chunkIndex}`", async () => {
    const built = await buildVectorShards(sources, "en", {
      embed: fixedDimEmbed,
      quantization: "float32",
    });
    for (const entry of built.shardsByLanguage.en?.entries ?? []) {
      expect(entry.passageId).toBe(`${entry.docId}-0`);
    }
  });

  it("float32 quantization stores embed()'s raw output as-is, no quantRange", async () => {
    const built = await buildVectorShards(sources, "en", {
      embed: fixedDimEmbed,
      quantization: "float32",
    });
    const shard = built.shardsByLanguage.en as VectorShard;
    expect(shard.quantization).toBe("float32");
    expect(shard.quantRange).toBeUndefined();
    expect(built.dims).toBe(3);
    for (const entry of shard.entries) {
      // fixedDimEmbed's constant third dimension survives untouched --
      // proof this is really the raw embed() output, not a quantized
      // round-trip of it.
      expect(entry.vector).toHaveLength(3);
      expect(entry.vector[2]).toBe(1);
    }
  });

  it("int8 quantization (the default) round-trips within scalar-quantization error and records quantRange", async () => {
    const built = await buildVectorShards(sources, "en", {
      embed: fixedDimEmbed,
    });
    const shard = built.shardsByLanguage.en as VectorShard;
    expect(shard.quantization).toBe("int8");
    expect(shard.quantRange).toBeDefined();
    for (const entry of shard.entries) {
      for (const raw of entry.vector) {
        expect(Number.isInteger(raw)).toBe(true);
        expect(raw).toBeGreaterThanOrEqual(0);
        expect(raw).toBeLessThanOrEqual(255);
      }
    }
  });

  it("defaults embeddingProvider to { type: 'custom' } when not given", async () => {
    const built = await buildVectorShards(sources, "en", {
      embed: fixedDimEmbed,
    });
    expect(built.embeddingProvider).toEqual({ type: "custom" });
  });

  it("records a caller-supplied embeddingProvider as-is", async () => {
    const built = await buildVectorShards(sources, "en", {
      embed: fixedDimEmbed,
      provider: { type: "local-model", model: "test-model-v1" },
    });
    expect(built.embeddingProvider).toEqual({
      type: "local-model",
      model: "test-model-v1",
    });
  });

  it("throws when embed() returns the wrong number of vectors", async () => {
    await expect(
      buildVectorShards(sources, "en", {
        embed: (texts) => texts.slice(1).map(() => [1, 2, 3]),
      }),
    ).rejects.toThrow(/returned .* vectors/);
  });

  it("throws when embed() returns inconsistent vector dimensions", async () => {
    let call = 0;
    await expect(
      buildVectorShards(sources, "en", {
        embed: (texts) =>
          texts.map(() => {
            call++;
            return call === 1 ? [1, 2, 3] : [1, 2];
          }),
      }),
    ).rejects.toThrow(/inconsistent|dimensional/);
  });

  it("throws on an invalid chunkTokens/chunkOverlapTokens combination", async () => {
    await expect(
      buildVectorShards(sources, "en", {
        embed: fixedDimEmbed,
        chunkTokens: 0,
      }),
    ).rejects.toThrow(/chunkTokens/);
    await expect(
      buildVectorShards(sources, "en", {
        embed: fixedDimEmbed,
        chunkTokens: 10,
        chunkOverlapTokens: 10,
      }),
    ).rejects.toThrow(/chunkOverlapTokens/);
  });

  it("writeIndex writes one vectors/<lang>.json file per language and records manifest.vectors", async () => {
    const outDir = await tempOutDir();
    const built = buildIndex(sources.slice(0, 3), "en");
    const vectors = await buildVectorShards(sources, "en", {
      embed: fixedDimEmbed,
    });
    await writeIndex(built, outDir, { vectors });

    const manifest = JSON.parse(
      await readFile(join(outDir, "manifest.json"), "utf8"),
    );
    expect(manifest.vectors.dims).toBe(3);
    expect(manifest.vectors.quantization).toBe("int8");
    expect(manifest.vectors.embeddingProvider).toEqual({ type: "custom" });
    expect(Object.keys(manifest.vectors.shards).sort()).toEqual(["de", "en"]);

    const enShard: VectorShard = JSON.parse(
      await readFile(join(outDir, manifest.vectors.shards.en), "utf8"),
    );
    expect(enShard.entries.map((e) => e.docId).sort()).toEqual([1, 2]);
  });

  it("writeIndex omits manifest.vectors entirely when no vectors option is given", async () => {
    const outDir = await tempOutDir();
    const built = buildIndex(sources.slice(0, 3), "en");
    await writeIndex(built, outDir);
    const manifest = JSON.parse(
      await readFile(join(outDir, "manifest.json"), "utf8"),
    );
    expect(manifest.vectors).toBeUndefined();
  });
});
