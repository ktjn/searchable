import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Manifest } from "@ktjn/searchable-format";

export interface VectorFixtureSource {
  id: number;
  language: string;
  text: string;
}

function quantizeInt8(vectors: number[][]): {
  quantized: number[][];
  quantRange: { min: number; max: number };
} {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const vector of vectors) {
    for (const value of vector) {
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { quantized: vectors, quantRange: { min: 0, max: 0 } };
  }
  const range = max - min;
  const quantized = vectors.map((vector) =>
    vector.map((value) =>
      range === 0 ? 0 : Math.round(((value - min) / range) * 255),
    ),
  );
  return { quantized, quantRange: { min, max } };
}

/**
 * Hand-builds vector shards and patches them into an already-written
 * manifest.json -- no indexer involved, since the Python indexer has no
 * vector/embedding support yet (see the "Follow-up" section of
 * docs/superpowers/specs/2026-07-29-remove-ts-index-generation-design.md).
 * Deliberately skips real chunking (chunkText()'s ~200-token windows):
 * every fixture source these tests use is a single short sentence, well
 * under any real chunking threshold, so "one chunk = the whole text" is
 * exactly what real chunking would also produce here.
 */
export async function writeVectorFixture(
  outDir: string,
  sources: VectorFixtureSource[],
  embed: (texts: string[]) => number[][] | Promise<number[][]>,
  quantization: "int8" | "float32" = "int8",
): Promise<void> {
  const manifestPath = join(outDir, "manifest.json");
  const manifest: Manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  const byLanguage = new Map<string, VectorFixtureSource[]>();
  for (const source of sources) {
    const list = byLanguage.get(source.language) ?? [];
    list.push(source);
    byLanguage.set(source.language, list);
  }

  const shardFiles: Record<string, string> = {};
  let dims = 0;
  let dimsLanguage: string | undefined;

  for (const [language, languageSources] of byLanguage) {
    const rawVectors = await embed(languageSources.map((s) => s.text));
    if (rawVectors.length !== languageSources.length) {
      throw new Error(
        `writeVectorFixture: embed() returned ${rawVectors.length} vectors for ${languageSources.length} input texts`,
      );
    }
    const languageDims = rawVectors[0]?.length ?? 0;
    if (dimsLanguage !== undefined && languageDims !== dims) {
      throw new Error(
        `writeVectorFixture: embed() returned ${languageDims}-dimensional vectors for language "${language}", but ${dims}-dimensional vectors for language "${dimsLanguage}" -- all languages must share the same embedding dimensionality`,
      );
    }
    dims = languageDims;
    dimsLanguage = language;

    let entries: { passageId: string; docId: number; vector: number[] }[];
    let quantRange: { min: number; max: number } | undefined;
    if (quantization === "int8") {
      const { quantized, quantRange: range } = quantizeInt8(rawVectors);
      quantRange = range;
      entries = languageSources.map((s, i) => ({
        passageId: `${s.id}-0`,
        docId: s.id,
        vector: quantized[i] as number[],
      }));
    } else {
      entries = languageSources.map((s, i) => ({
        passageId: `${s.id}-0`,
        docId: s.id,
        vector: rawVectors[i] as number[],
      }));
    }

    const relPath = `vectors/${language}.json`;
    await mkdir(join(outDir, "vectors"), { recursive: true });
    await writeFile(
      join(outDir, relPath),
      JSON.stringify({
        dims,
        quantization,
        ...(quantRange ? { quantRange } : {}),
        entries,
      }),
      "utf8",
    );
    shardFiles[language] = relPath;
  }

  manifest.vectors = {
    dims,
    quantization,
    embeddingProvider: { type: "custom" },
    shards: shardFiles,
  };

  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
}
