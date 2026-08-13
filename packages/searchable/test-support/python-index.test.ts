import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writePythonIndex } from "./python-index.js";

describe("writePythonIndex", () => {
  it("builds a manifest.json for a single document", async () => {
    const { outDir, cleanup } = await writePythonIndex([
      {
        id: 0,
        url: "/a",
        html: '<html lang="en"><head><title>Widgets</title></head><body><main><p>Our widgets are wonderful.</p></main></body></html>',
      },
    ]);
    try {
      const manifest = JSON.parse(
        await readFile(join(outDir, "manifest.json"), "utf8"),
      );
      expect(manifest.docCount.en).toBe(1);
    } finally {
      await cleanup();
    }
  });

  it("passes build/write options through (fuzzy)", async () => {
    const { outDir, cleanup } = await writePythonIndex(
      [
        {
          id: 0,
          url: "/a",
          html: '<html lang="en"><head><title>Widgets</title></head><body><main><p>Our widgets are wonderful.</p></main></body></html>',
        },
      ],
      { fuzzy: true },
    );
    try {
      const manifest = JSON.parse(
        await readFile(join(outDir, "manifest.json"), "utf8"),
      );
      expect(manifest.fuzzy).toBeDefined();
    } finally {
      await cleanup();
    }
  });
});
