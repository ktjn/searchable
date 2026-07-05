import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Some sandboxed dev environments pre-install a Chromium build at a
// fixed path instead of the exact revision this Playwright version
// would normally download — point at it directly when present so
// local runs don't try (and fail) to download a browser. CI installs
// its own browsers via `playwright install` and never has this path,
// so this has no effect there.
const sandboxChromium = "/opt/pw-browsers/chromium";
const executablePath = existsSync(sandboxChromium)
  ? sandboxChromium
  : undefined;

export default defineConfig({
  testDir: ".",
  testMatch: [
    "packages/client/e2e-browser/**/*.spec.ts",
    "showcase/e2e-browser/**/*.spec.ts",
  ],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "line",
  use: {
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: executablePath ? { executablePath } : {},
      },
    },
  ],
});
