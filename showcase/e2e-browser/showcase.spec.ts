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
    await page.goto(`${baseUrl}docs/getting-started/overview.html`);
    await expect(page).toHaveTitle("Overview");
    await expect(page.locator("main h1")).toHaveText("Overview");
    await page.click('nav a:has-text("Architecture")');
    await expect(page).toHaveTitle("Architecture");
  });

  test("search returns ranked results and navigating to one loads the right page", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}docs/getting-started/overview.html`);

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

  test("accessibility: announces result count via aria-live and toggles aria-expanded (docs/reference/client-api.md)", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}docs/getting-started/overview.html`);
    const input = page.locator(".csf-search-input");
    const announcer = page.locator('[role="status"].csf-sr-only');

    await expect(input).toHaveAttribute("aria-expanded", "false");
    await expect(announcer).toHaveText("");

    await input.fill("prefix matching");
    await expect(input).toHaveAttribute("aria-expanded", "true");
    await expect(announcer).toContainText('results for "prefix matching"');

    await input.fill("zzzznonexistentqueryzzzz");
    await expect(announcer).toHaveText(
      'No results for "zzzznonexistentqueryzzzz".',
    );

    await input.fill("");
    await expect(input).toHaveAttribute("aria-expanded", "false");
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

  test("accessibility: result count is an aria-live region (docs/reference/client-api.md)", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}gallery/products/index.html`);
    const summary = page.locator(".gallery-results-summary");
    await expect(summary).toHaveAttribute("role", "status");
    await expect(summary).toHaveAttribute("aria-live", "polite");
    await expect(summary).toContainText("result");

    const beforeText = await summary.textContent();
    await page
      .locator(
        ".gallery-facet-group:has-text('category') label:has-text(\"Furniture\")",
      )
      .locator("input")
      .check();
    await expect(summary).not.toHaveText(beforeText ?? "");
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
    // "wireless" stems to itself unchanged (ends in "ss", protected from
    // suffix-stripping); "wirelss" (drop the second "e") is a genuine
    // one-edit-distance typo of it that *also* stems to itself
    // unchanged, unlike "wireles" (drop one "s"), which the stemmer
    // itself further reduces to "wirel" -- three edits from "wireless",
    // well past the strict maxEdits:1 fuzzy dictionary regardless of
    // the toggle (docs/guides/internationalization.md#stemming interacting
    // with docs/guides/ranking-and-boosts.md#prefix-and-fuzzy-matching).
    await page.locator(".gallery-search-input").fill("wirelss");

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

test.describe("feature gallery: synonym playground demo (real browser)", () => {
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

  test("does not cross vocabulary by default (synonyms off)", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}gallery/synonyms/index.html`);
    await expect(page.locator(".gallery-search-input")).toHaveValue("sofa");
    await expect(page.locator(".gallery-hit-list li")).toHaveCount(1);
    await expect(page.locator(".gallery-hit-title")).toContainText(
      "Sofa Collection",
    );
  });

  test("enabling synonym expansion crosses the equivalence class and labels the expanded match", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}gallery/synonyms/index.html`);
    await page.locator(".gallery-synonyms-toggle input").check();

    await expect(page.locator(".gallery-hit-list li")).toHaveCount(2);
    const first = page.locator(".gallery-hit-list li").first();
    const second = page.locator(".gallery-hit-list li").nth(1);
    await expect(first).toContainText("Sofa Collection");
    await expect(first.locator(".gallery-badge")).toHaveCount(0);
    await expect(second).toContainText("Couch Showroom");
    await expect(second.locator(".gallery-badge")).toHaveText("Synonym match");
  });

  test("directional synonym only expands forward: laptop -> notebook, not back", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}gallery/synonyms/index.html`);
    await page.locator(".gallery-synonyms-toggle input").check();

    await page.locator(".gallery-search-input").fill("laptop");
    await expect(page.locator(".gallery-hit-list li")).toHaveCount(2);
    await expect(page.locator(".gallery-hit-list li").last()).toContainText(
      "Notebook Reviews",
    );

    await page.locator(".gallery-search-input").fill("notebook");
    await expect(page.locator(".gallery-hit-list li")).toHaveCount(1);
    await expect(page.locator(".gallery-hit-title")).toContainText(
      "Notebook Reviews",
    );
  });

  test("an unrelated term never expands, on or off", async ({ page }) => {
    await page.goto(`${baseUrl}gallery/synonyms/index.html`);
    await page.locator(".gallery-search-input").fill("loveseat");
    await expect(page.locator(".gallery-hit-list li")).toHaveCount(1);

    await page.locator(".gallery-synonyms-toggle input").check();
    await expect(page.locator(".gallery-hit-list li")).toHaveCount(1);
    await expect(page.locator(".gallery-badge")).toHaveCount(0);
  });
});

test.describe("feature gallery: multi-language corpus demo (real browser)", () => {
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

  test("the identically-spelled word 'espresso' returns only that language's own page", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}gallery/i18n/index.html`);
    await expect(page.locator(".gallery-language-select")).toHaveValue("en");
    await expect(page.locator(".gallery-hit-list li")).toHaveCount(1);
    await expect(page.locator(".gallery-hit-title")).toContainText(
      "Espresso Basics",
    );

    await page.locator(".gallery-language-select").selectOption("de");
    await expect(page.locator(".gallery-hit-list li")).toHaveCount(1);
    await expect(page.locator(".gallery-hit-title")).toContainText(
      "Espresso Grundlagen",
    );
  });

  test("the German stemmer's own umlaut-fold surfaces both schon and schön for either query (docs/guides/internationalization.md#case-folding-and-diacritics)", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}gallery/i18n/index.html`);
    await page.locator(".gallery-language-select").selectOption("de");

    // foldDiacritics:false keeps "schon" and "schön" distinct going
    // into the stemmer, but the real Snowball German stemmer's own
    // final step folds any remaining umlaut to a plain vowel -- both
    // words stem to "schon", so either query now surfaces both pages
    // rather than only its own literal match.
    await page.locator(".gallery-search-input").fill("schon");
    await expect(page.locator(".gallery-hit-list li")).toHaveCount(2);
    const titlesForSchon = await page
      .locator(".gallery-hit-title")
      .allTextContents();
    expect(titlesForSchon.some((t) => t.includes("Schon unterwegs"))).toBe(
      true,
    );
    expect(titlesForSchon.some((t) => t.includes("Schöne Aussicht"))).toBe(
      true,
    );

    await page.locator(".gallery-search-input").fill("schön");
    await expect(page.locator(".gallery-hit-list li")).toHaveCount(2);
    const titlesForSchoen = await page
      .locator(".gallery-hit-title")
      .allTextContents();
    expect(titlesForSchoen.some((t) => t.includes("Schon unterwegs"))).toBe(
      true,
    );
    expect(titlesForSchoen.some((t) => t.includes("Schöne Aussicht"))).toBe(
      true,
    );
  });
});
