import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        worker: resolve(__dirname, "src/worker.ts"),
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    target: "es2022",
    // @csf/analysis and @csf/format are bundled in (not external) here,
    // unlike the indexer's Node-only build — worker.js in particular is
    // loaded via a raw `new Worker(url)` reference that a consumer's
    // bundler may never re-process, so it has to be a fully
    // self-contained file, not one with unresolved bare specifiers.
    // Both packages are well under 1KB gzipped, so inlining costs
    // nothing meaningful against the bundle-size budget.
  },
});
