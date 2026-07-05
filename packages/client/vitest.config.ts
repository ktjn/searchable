import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // e2e-browser/ holds Playwright specs (run via `pnpm test:browser`),
    // not Vitest tests — Vitest's default glob would otherwise also
    // match *.spec.ts there and try to run them under the wrong runner.
    exclude: ["**/node_modules/**", "**/dist/**", "e2e-browser/**"],
  },
});
