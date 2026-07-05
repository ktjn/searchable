import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      formats: ["es"],
      fileName: () => "index.js",
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
      ],
    },
  },
});
