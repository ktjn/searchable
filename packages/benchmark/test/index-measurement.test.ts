import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { generateCms2kCorpus } from "@ktjn/searchable-fixtures";
import { afterEach, describe, expect, it } from "vitest";
import { inventoryArtifacts, measureIndex } from "../src/index-measurement.js";

const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "searchable-benchmark-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("index measurement", () => {
  it("measures a real generated index and sorted artifact inventory", async () => {
    const documents = generateCms2kCorpus({
      count: 3,
      languages: ["en"],
    }).slice(0, 3);
    const directory = await temporaryDirectory();

    const measurement = await measureIndex(documents, 1.25, directory);

    expect(measurement.documentCount).toBe(documents.length);
    expect(measurement.generationMs).toBe(1.25);
    expect(measurement.buildMs).toBeGreaterThanOrEqual(0);
    expect(measurement.writeMs).toBeGreaterThanOrEqual(0);
    expect(measurement.totalRawBytes).toBeGreaterThan(0);
    expect(measurement.totalGzipBytes).toBeGreaterThan(0);
    expect(measurement.manifestRawBytes).toBeGreaterThan(0);
    expect(measurement.fileCount).toBe(measurement.artifacts.length);
    expect(measurement.artifacts.map(({ path }) => path)).toEqual(
      [...measurement.artifacts.map(({ path }) => path)].sort(),
    );
    expect(measurement.artifacts).toContainEqual(
      expect.objectContaining({ path: "manifest.json" }),
    );
  });

  it("recursively inventories raw and level-9 gzip-equivalent bytes", async () => {
    const directory = await temporaryDirectory();
    const rootBytes = Buffer.from("root artifact\n");
    const nestedBytes = Buffer.from(
      "nested artifact with repeated repeated text\n",
    );
    await mkdir(join(directory, "zeta"));
    await writeFile(join(directory, "root.txt"), rootBytes);
    await writeFile(join(directory, "zeta", "nested.txt"), nestedBytes);

    await expect(inventoryArtifacts(directory)).resolves.toEqual([
      {
        path: "root.txt",
        rawBytes: rootBytes.length,
        gzipBytes: gzipSync(rootBytes, { level: 9 }).length,
      },
      {
        path: "zeta/nested.txt",
        rawBytes: nestedBytes.length,
        gzipBytes: gzipSync(nestedBytes, { level: 9 }).length,
      },
    ]);
  });
});
