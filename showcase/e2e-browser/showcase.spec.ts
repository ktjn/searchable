import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { serveDir } from "./serve-dir.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "..", "dist");

test.describe("showcase (docs site + real search, real browser)", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;

  test.beforeAll(async () => {
    const server = await serveDir(distDir);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  test.afterAll(async () => {
    await closeServer();
  });

  test("renders the docs site with working nav", async ({ page }) => {
    await page.goto(`${baseUrl}docs/00-overview.html`);
    await expect(page).toHaveTitle("Overview");
    await expect(page.locator("main h1")).toHaveText("Overview");
    await page.click('nav a:has-text("Architecture")');
    await expect(page).toHaveTitle("Architecture");
  });

  test("search returns ranked results and navigating to one loads the right page", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}docs/00-overview.html`);

    const input = page.locator(".csf-search-input");
    await input.fill("prefix matching");
    await expect(page.locator(".csf-search-results")).toHaveClass(/is-open/);

    const firstResult = page.locator(".csf-search-results li a").first();
    await expect(firstResult).toBeVisible();

    await firstResult.click();
    await page.waitForLoadState("load");
    await expect(page).toHaveTitle("Query Language, Ranking & Boosts");
  });

  test("shows a no-results state for a nonsense query", async ({ page }) => {
    await page.goto(`${baseUrl}index.html`);
    await page.locator(".csf-search-input").fill("zzzznonexistentqueryzzzz");
    await expect(page.locator(".csf-empty")).toBeVisible();
  });
});
