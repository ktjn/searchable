import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

/**
 * Issue #1 finding 3 (productization review): proves `package.json`'s
 * `exports` map actually resolves the way an external consumer's bundler
 * or `node` would resolve it -- not just "the file exists on disk at the
 * path we expect," but genuine package-name resolution through Node's
 * own module resolution algorithm, the same mechanism a consumer's
 * `import "@ktjn/searchable/worker"` goes through. `require.resolve()` (via
 * `createRequire`) honors the `exports` field including conditional
 * subpaths, and resolves "@ktjn/searchable" as this package's own name with
 * no `node_modules` symlink required (Node's self-referencing-package
 * feature) -- so this is a faithful test of the manifest shape itself,
 * not an artifact of the monorepo's workspace linking. (`import.meta.resolve`
 * would be the more direct equivalent, but Vitest's SSR module transform
 * doesn't implement it, so this uses the CJS-style `require.resolve`
 * escape hatch instead -- resolution semantics for `exports` are the
 * same either way.)
 */
const require = createRequire(import.meta.url);

describe("package.json exports (consumer-fixture)", () => {
  it("resolves the main entry and it exports SearchClient", async () => {
    const resolved = require.resolve("@ktjn/searchable");
    expect(existsSync(resolved)).toBe(true);
    const mod = await import("@ktjn/searchable");
    expect(typeof mod.SearchClient).toBe("function");
  });
});
