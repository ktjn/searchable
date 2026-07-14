import { readdir, readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { join, relative, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { buildIndex, writeIndex } from "@ktjn/searchable-indexer";
import type {
  ArtifactMeasurement,
  IndexMeasurement,
} from "./types.js";

async function listFiles(
  rootDirectory: string,
  directory: string,
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(rootDirectory, path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

export async function inventoryArtifacts(
  outputDirectory: string,
): Promise<ArtifactMeasurement[]> {
  const files = await listFiles(outputDirectory, outputDirectory);
  const artifacts = await Promise.all(
    files.map(async (file): Promise<ArtifactMeasurement> => {
      const bytes = await readFile(file);
      return {
        path: relative(outputDirectory, file).split(sep).join("/"),
        rawBytes: bytes.length,
        gzipBytes: gzipSync(bytes, { level: 9 }).length,
      };
    }),
  );
  return artifacts.sort((left, right) => left.path.localeCompare(right.path));
}

export async function measureIndex(
  documents: Array<{ id: number; url: string; html: string }>,
  generationMs: number,
  outputDirectory: string,
): Promise<IndexMeasurement> {
  const buildStartedAt = performance.now();
  const index = buildIndex(documents);
  const buildMs = performance.now() - buildStartedAt;

  const writeStartedAt = performance.now();
  await writeIndex(index, outputDirectory);
  const writeMs = performance.now() - writeStartedAt;

  const artifacts = await inventoryArtifacts(outputDirectory);
  const manifestArtifact = artifacts.find(
    (artifact) => artifact.path === "manifest.json",
  );
  if (!manifestArtifact) throw new Error("index did not emit manifest.json");

  const manifest = JSON.parse(
    await readFile(join(outputDirectory, "manifest.json"), "utf8"),
  ) as { shards?: Record<string, unknown> };
  if (!manifest.shards) throw new Error("manifest does not define shards");
  const shardCount = Object.values(manifest.shards).reduce<number>(
    (count, value) => count + (Array.isArray(value) ? value.length : 0),
    0,
  );

  return {
    documentCount: documents.length,
    generationMs,
    buildMs,
    writeMs,
    totalRawBytes: artifacts.reduce(
      (total, artifact) => total + artifact.rawBytes,
      0,
    ),
    totalGzipBytes: artifacts.reduce(
      (total, artifact) => total + artifact.gzipBytes,
      0,
    ),
    manifestRawBytes: manifestArtifact.rawBytes,
    fileCount: artifacts.length,
    shardCount,
    artifacts,
  };
}
