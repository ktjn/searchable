import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        cli: resolve(__dirname, "src/cli.ts"),
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    target: "node20",
    ssr: true,
    rollupOptions: {
      external: [
        "node:fs",
        "node:path",
        "node:crypto",
        "node-html-parser",
        "@csf/analysis",
        "@csf/format",
        "@huggingface/transformers",
      ],
    },
  },
});
