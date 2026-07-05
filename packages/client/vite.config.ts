import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      formats: ["es"],
      fileName: () => "index.js",
    },
    target: "es2022",
    rollupOptions: {
      external: ["@csf/analysis", "@csf/format"],
    },
  },
});
