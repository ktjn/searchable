import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/analysis",
      "packages/client",
      "packages/fixtures",
      "packages/format",
      "packages/relevance",
      "showcase",
    ],
  },
});
