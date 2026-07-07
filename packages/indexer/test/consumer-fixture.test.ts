import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

/**
 * Issue #1 finding 3 (productization review): proves `package.json`'s
 * `exports`/`bin` fields actually resolve the way an external consumer
 * would resolve them, not just "the file exists on disk at the path we
 * expect." `require.resolve()` (via `createRequire`) honors the
 * `exports` field and resolves "@csf/indexer" as this package's own
 * name with no `node_modules` symlink required (Node's self-referencing-
 * package feature), so this is a faithful test of the manifest shape
 * itself. (`import.meta.resolve` would be the more direct ESM
 * equivalent, but Vitest's SSR module transform doesn't implement it.)
 */
const require = createRequire(import.meta.url);

describe("package.json exports/bin (consumer-fixture)", () => {
  it("resolves the main entry and it exports buildIndex/writeIndex", async () => {
    const resolved = require.resolve("@csf/indexer");
    expect(existsSync(resolved)).toBe(true);
    const mod = await import("@csf/indexer");
    expect(typeof mod.buildIndex).toBe("function");
    expect(typeof mod.writeIndex).toBe("function");
  });

  it("declares a bin entry whose target file exists after build", async () => {
    const mainEntryPath = require.resolve("@csf/indexer");
    const packageRoot = dirname(dirname(mainEntryPath)); // dist/index.js -> package root
    const pkg = JSON.parse(
      await readFile(join(packageRoot, "package.json"), "utf8"),
    );
    expect(pkg.bin).toEqual({ "csf-indexer": "./dist/cli.js" });
    const cliPath = join(packageRoot, pkg.bin["csf-indexer"]);
    expect(existsSync(cliPath)).toBe(true);
  });

  const outDirs: string[] = [];
  afterEach(async () => {
    await Promise.all(
      outDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("runs as a real executable script via node, indexing a directory end-to-end", async () => {
    const mainEntryPath = require.resolve("@csf/indexer");
    const cliPath = join(dirname(mainEntryPath), "cli.js");

    const inputDir = await mkdtemp(join(tmpdir(), "csf-cli-in-"));
    const outDir = await mkdtemp(join(tmpdir(), "csf-cli-out-"));
    outDirs.push(inputDir, outDir);
    await writeFile(
      join(inputDir, "index.html"),
      `<html lang="en"><head><title>Hello</title></head><body><main><p>Hello world, a simple test page.</p></main></body></html>`,
    );

    const { stdout } = await execFileAsync("node", [cliPath, inputDir, outDir]);
    expect(stdout).toMatch(/indexed 1 document\(s\)/);

    const manifest = JSON.parse(
      await readFile(join(outDir, "manifest.json"), "utf8"),
    );
    expect(manifest.docCount.en).toBe(1);
  });
});
