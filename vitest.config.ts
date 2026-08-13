import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/searchable", "tools/fixtures", "showcase"],
  },
});
