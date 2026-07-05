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

test.describe("feature gallery: product catalog demo (real browser)", () => {
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

  test("loads with the default browse-all query and renders facet checkboxes", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}gallery/products/index.html`);
    await expect(page.locator(".gallery-search-input")).toHaveValue("product");
    await expect(page.locator(".gallery-hit-list li")).not.toHaveCount(0);
    await expect(
      page.locator(".gallery-facet-group:has-text('category')"),
    ).toBeVisible();
  });

  test("checking a category facet filters results and updates counts", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}gallery/products/index.html`);
    await expect(page.locator(".gallery-hit-list li").first()).toBeVisible();
    const beforeCount = await page.locator(".gallery-hit-list li").count();

    await page
      .locator(
        ".gallery-facet-group:has-text('category') label:has-text(\"Furniture\")",
      )
      .locator("input")
      .check();

    await expect(async () => {
      const afterCount = await page.locator(".gallery-hit-list li").count();
      expect(afterCount).toBeLessThan(beforeCount);
      expect(afterCount).toBeGreaterThan(0);
    }).toPass();

    for (const title of await page
      .locator(".gallery-hit-title")
      .allTextContents()) {
      expect(title).not.toBe("");
    }
  });

  test("a matching best-bet pin is labeled and outranks organic ordering", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}gallery/products/index.html`);
    await page.locator(".gallery-search-input").fill("returns policy");
    const first = page.locator(".gallery-hit-list li").first();
    await expect(first.locator(".gallery-badge")).toHaveText("Pinned");
    await expect(first).toContainText("Returns Policy");
  });

  test("fuzzy toggle: a typo finds nothing until fuzzy matching is enabled", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}gallery/products/index.html`);
    await page.locator(".gallery-search-input").fill("wireles");

    await expect(page.locator(".gallery-empty")).toBeVisible();

    await page.locator(".gallery-fuzzy-toggle input").check();
    await expect(page.locator(".gallery-empty")).toHaveCount(0);
    await expect(page.locator(".gallery-hit-list li")).not.toHaveCount(0);
  });

  test("clicking a result navigates to the real product page", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}gallery/products/index.html`);
    await page.locator(".gallery-search-input").fill("desk");
    const firstResult = page.locator(".gallery-hit-list li a").first();
    // waits out the debounce + async search before reading/clicking, so the
    // title captured is the one actually clicked, not a stale pre-update row
    await expect(firstResult.locator(".gallery-hit-title")).toContainText(
      /desk/i,
    );
    const title = await firstResult.locator(".gallery-hit-title").textContent();
    await firstResult.click();
    await page.waitForLoadState("load");
    await expect(page.locator("main h1")).toHaveText((title ?? "").trim());
  });
});
