// Single source of truth for shelling out to the Python `searchable-indexer`
// from TypeScript. Previously triplicated in packages/client/test-support,
// packages/relevance/src, and showcase (each a "keep in sync" copy differing
// only in repoRoot depth); now the copies are one-line re-export facades and
// the implementation lives here, so the repoRoot depth is computed once.

import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface PythonSourceDocument {
  id: number;
  url: string;
  html: string;
}

export interface PythonStructuredDocument {
  id: number;
  externalId?: string;
  url: string;
  language?: string;
  indexedFields: Record<string, string>;
  storedFields?: Record<string, string>;
  metadata?: Record<string, unknown>;
  boost?: number;
}

export interface PythonBuildOptions {
  defaultLanguage?: string;
  fieldBoosts?: Record<string, number>;
  allowedUrlOrigins?: string[];
  canonicalBaseUrl?: string;
  hierarchicalFacets?: Record<string, Record<string, unknown>>;
  rangeFacetBuckets?: Record<string, number | number[]>;
  synonyms?: Record<string, unknown>;
  fuzzy?: boolean;
  fuzzyMaxEdits?: number;
  /**
   * Name of a deterministic, test-only embedder registered in
   * `python/searchable-indexer/scripts/build_from_config.py` (a Python
   * callable can't cross the JSON config boundary, so this is a sentinel
   * the driver script resolves to a real function) -- currently only
   * `"deterministic"` is registered.
   */
  embed?: "deterministic";
  embeddingProvider?:
    | { type: "local-model"; model: string }
    | { type: "remote-api" }
    | { type: "custom" };
  vectorQuantization?: "int8" | "float32";
  vectorWindow?: number;
  vectorOverlap?: number;
  fieldDefinitions?: Record<
    string,
    { indexed?: boolean; stored?: boolean; boost?: number }
  >;
}

export interface PythonWriteOptions {
  maxShardGzipBytes?: number;
  shardByPrefix?: boolean;
  docStoreShardSize?: number;
  termShardFormat?: "json" | "binary";
  docStoreFormat?: "json" | "binary";
  fuzzyShardFormat?: "json" | "binary";
}

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const pythonIndexerDir = join(repoRoot, "python", "searchable-indexer");
const scriptPath = join(pythonIndexerDir, "scripts", "build_from_config.py");

function toSnakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function toSnakeCaseConfig(
  options: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options)) {
    result[toSnakeCase(key)] = value;
  }
  return result;
}

/**
 * Builds an index via the real Python `searchable-indexer` -- the
 * project's only index generator -- by shelling out to a small JSON-driven
 * driver script (python/searchable-indexer/scripts/build_from_config.py).
 * `uv` must be on PATH and `python/searchable-indexer` must have run
 * `uv sync` at least once (CI's Python setup step does this).
 */
export async function writePythonIndex(
  sources: Array<PythonSourceDocument | PythonStructuredDocument>,
  buildOptions: PythonBuildOptions = {},
  writeOptions: PythonWriteOptions = {},
): Promise<{ outDir: string; cleanup: () => Promise<void> }> {
  const workDir = await mkdtemp(join(tmpdir(), "python-index-"));
  const sourcesPath = join(workDir, "sources.json");
  const configPath = join(workDir, "config.json");
  const outDir = join(workDir, "out");

  await writeFile(sourcesPath, JSON.stringify(sources), "utf8");
  await writeFile(
    configPath,
    JSON.stringify({
      build: toSnakeCaseConfig(buildOptions as Record<string, unknown>),
      write: toSnakeCaseConfig(writeOptions as Record<string, unknown>),
    }),
    "utf8",
  );

  try {
    execFileSync(
      "uv",
      ["run", "python", scriptPath, sourcesPath, configPath, outDir],
      {
        cwd: pythonIndexerDir,
        stdio: "pipe",
        maxBuffer: 32 * 1024 * 1024,
      },
    );
  } catch (err) {
    const stderr =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr?: Buffer | string }).stderr ?? "")
        : "";
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${message}\n${stderr}`);
  }

  return {
    outDir,
    cleanup: () => rm(workDir, { recursive: true, force: true }),
  };
}

export function writePythonStructuredIndex(
  sources: PythonStructuredDocument[],
  buildOptions: Omit<PythonBuildOptions, "fieldDefinitions"> = {},
  writeOptions: PythonWriteOptions = {},
) {
  return writePythonIndex(
    sources,
    {
      ...buildOptions,
      fieldDefinitions: {
        title: { indexed: true, stored: true, boost: 1 },
        body: { indexed: true, stored: true, boost: 1 },
      },
    },
    writeOptions,
  );
}
