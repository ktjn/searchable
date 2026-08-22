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
    await expect(page.locator("header .brand")).toHaveText("Searchable");
    await page.click('nav a:has-text("Architecture")');
    await expect(page).toHaveTitle("Architecture");
  });

  test("homepage introduces the live feature gallery", async ({ page }) => {
    await page.goto(`${baseUrl}index.html`);
    await expect(
      page.locator(
        'main > p:first-of-type a[href="https://ktjn.github.io/searchable/gallery/"]',
      ),
    ).toHaveText("Try the live feature gallery");
  });

  test("docs search has stable form metadata and accessible page landmarks", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}docs/getting-started/overview.html`);
    const input = page.locator(".searchable-search-input");
    await expect(input).toHaveAttribute("name", "docs-search");
    await expect(input).toHaveAttribute("autocomplete", "off");
    await expect(input).toHaveAttribute("spellcheck", "false");
    const skipLink = page.locator('.skip-link[href="#main-content"]');
    await skipLink.focus();
    await expect(skipLink).toBeVisible();
    await expect(page.locator("main#main-content")).toHaveCount(1);
    await expect(page.locator("main h1")).toHaveCSS(
      "scroll-margin-top",
      "80px",
    );
  });

  test("search returns ranked results and navigating to one loads the right page", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}docs/getting-started/overview.html`);

    const input = page.locator(".searchable-search-input");
    await input.fill("prefix matching");
    await expect(page.locator(".searchable-search-results")).toHaveClass(
      /is-open/,
    );

    const firstResult = page.locator(".searchable-search-results li a").first();
    await expect(firstResult).toBeVisible();

    await firstResult.click();
    await page.waitForLoadState("load");
    await expect(page).toHaveTitle("Ranking and boosts");
  });

  test("shows a no-results state for a nonsense query", async ({ page }) => {
    await page.goto(`${baseUrl}index.html`);
    await page
      .locator(".searchable-search-input")
      .fill("zzzznonexistentqueryzzzz");
    await expect(page.locator(".searchable-empty")).toBeVisible();
  });

  test("accessibility: announces result count via aria-live and toggles aria-expanded (docs/reference/client-api.md)", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}docs/getting-started/overview.html`);
    const input = page.locator(".searchable-search-input");
    const announcer = page.locator('[role="status"].searchable-sr-only');

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

  test("mobile grouped navigation and gallery cards do not overflow the page", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseUrl}docs/getting-started/overview.html`);

    await expect(page.locator(".nav-section").first()).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    await page.goto(`${baseUrl}gallery/index.html`);
    await expect(page.locator(".quick-example-card")).toHaveCount(15);
    await expect(page.locator(".gallery-results-summary")).toHaveCount(15);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
});

test.describe("feature gallery: quick examples (real browser)", () => {
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

  test("quick examples expose a loading status before becoming ready", async ({
    page,
  }) => {
    let releaseClient: (() => void) | undefined;
    const clientReleased = new Promise<void>((resolve) => {
      releaseClient = resolve;
    });
    await page.route("**/assets/index.js", async (route) => {
      await clientReleased;
      await route.continue();
    });

    await page.goto(`${baseUrl}gallery/index.html`);
    await expect(page.locator('.gallery-loading[role="status"]')).toHaveCount(
      15,
    );

    releaseClient?.();
    await expect(
      page.locator('[data-example-card="basic"] .gallery-results-summary'),
    ).toContainText(/result/);
    await expect(page.locator(".gallery-loading")).toHaveCount(0);
  });

  test("quick examples expose identity and search busy state", async ({
    page,
  }) => {
    let releaseManifest: (() => void) | undefined;
    const manifestReleased = new Promise<void>((resolve) => {
      releaseManifest = resolve;
    });
    await page.route(
      "**/gallery/products/search-index/manifest.json",
      async (route) => {
        await manifestReleased;
        await route.continue();
      },
    );

    await page.goto(`${baseUrl}gallery/index.html`);
    const basic = page.locator(
      '[data-example-card="basic"] [data-gallery-root]',
    );
    await expect(basic).toHaveAttribute("data-example-id", "basic");
    await expect(basic).toHaveAttribute("aria-busy", "true");

    releaseManifest?.();
    await expect(basic.locator(".gallery-results-summary")).toContainText(
      /result/,
    );
    await expect(basic).toHaveAttribute("aria-busy", "false");
  });

  for (const id of [
    "basic",
    "fuzzy",
    "facets",
    "synonyms",
    "pinning",
    "internationalization",
    "highlighting",
    "operator",
    "phrase",
    "prefix",
    "boosts",
    "did-you-mean",
    "browse",
    "geo",
    "exact-match",
  ]) {
    test(`quick example ${id} loads real results`, async ({ page }) => {
      await page.goto(`${baseUrl}gallery/index.html`);
      const card = page.locator(`[data-example-card="${id}"]`);
      await expect(card.locator(".gallery-results-summary")).toContainText(
        /result/,
      );
      await expect(card.locator(".gallery-error")).toHaveCount(0);
    });
  }

  test("quick examples render at most four results", async ({ page }) => {
    await page.goto(`${baseUrl}gallery/index.html`);
    const cards = page.locator(".quick-example-card");
    await expect(page.locator(".gallery-loading")).toHaveCount(0);
    for (let index = 0; index < (await cards.count()); index++) {
      expect(
        await cards.nth(index).locator(".gallery-hit-list li").count(),
      ).toBeLessThanOrEqual(4);
    }
  });

  test("quick examples exercise their distinct search behaviors", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}gallery/index.html`);

    const basic = page.locator('[data-example-card="basic"]');
    await expect(basic.locator(".gallery-hit-title").first()).toContainText(
      /desk/i,
    );

    const fuzzy = page.locator('[data-example-card="fuzzy"]');
    await expect(fuzzy.locator(".gallery-empty")).toBeVisible();
    await fuzzy.locator(".gallery-fuzzy-toggle input").check();
    await expect(fuzzy.locator(".gallery-badge-expansion").first()).toHaveText(
      "Fuzzy match",
    );

    const facets = page.locator('[data-example-card="facets"]');
    await expect(facets.locator(".gallery-facet-group")).toBeVisible();

    const synonyms = page.locator('[data-example-card="synonyms"]');
    await synonyms.locator(".gallery-synonyms-toggle input").check();
    await expect(
      synonyms.locator(".gallery-badge-expansion").first(),
    ).toHaveText("Synonym match");

    const pinning = page.locator('[data-example-card="pinning"]');
    await expect(pinning.locator(".gallery-badge").first()).toHaveText(
      "Pinned",
    );

    const i18n = page.locator('[data-example-card="internationalization"]');
    await expect(i18n.locator(".gallery-language-select")).toHaveValue("en");
    await i18n.locator(".gallery-language-select").selectOption("de");
    await expect(i18n.locator(".gallery-hit-title")).toContainText(
      "Espresso Grundlagen",
    );
  });

  test("newer quick examples exercise their distinct search behaviors", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}gallery/index.html`);

    const highlighting = page.locator('[data-example-card="highlighting"]');
    await expect(
      highlighting.locator(".gallery-hit-title").first(),
    ).toContainText(/headphones/i);
    await expect(
      highlighting.locator(".gallery-hit-highlight").first(),
    ).toHaveCount(1);

    const operator = page.locator('[data-example-card="operator"]');
    await expect(operator.locator(".gallery-operator-select")).toHaveValue(
      "or",
    );
    await expect(operator.locator(".gallery-hit-list li")).toHaveCount(4);
    await operator.locator(".gallery-operator-select").selectOption("and");
    await expect(operator.locator(".gallery-empty")).toBeVisible();

    const phrase = page.locator('[data-example-card="phrase"]');
    await expect(phrase.locator(".gallery-hit-title").first()).toContainText(
      "Mechanical Keyboard",
    );

    const prefix = page.locator('[data-example-card="prefix"]');
    await expect(prefix.locator(".gallery-hit-title").first()).toContainText(
      /headphones/i,
    );

    const boosts = page.locator('[data-example-card="boosts"]');
    await expect(boosts.locator(".gallery-operator-select")).toHaveValue("or");
    await expect(boosts.locator(".gallery-hit-title").first()).toContainText(
      /wireless mouse/i,
    );
    await boosts.locator(".gallery-boost-toggle input").check();
    await expect(boosts.locator(".gallery-hit-title").first()).toContainText(
      /bluetooth speaker/i,
    );

    const didYouMean = page.locator('[data-example-card="did-you-mean"]');
    await didYouMean.locator(".gallery-fuzzy-toggle input").check();
    await expect(didYouMean.locator(".gallery-did-you-mean")).toContainText(
      /wireless/,
    );

    const browse = page.locator('[data-example-card="browse"]');
    await expect(browse.locator(".gallery-facet-group")).toBeVisible();
    await expect(browse.locator(".gallery-empty")).toContainText(
      "Type a query",
    );
    await browse.locator(".gallery-search-input").fill("desk");
    await expect(browse.locator(".gallery-hit-list li").first()).toBeVisible();
  });

  test("inline source is keyboard-operable and links to its guide", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}gallery/index.html`);
    const card = page.locator('[data-example-card="fuzzy"]');
    await card.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(card.locator(".example-source")).toHaveAttribute("open", "");
    await expect(card.locator("pre code")).toContainText("wirelss");
    await expect(card.locator("a.example-guide")).toHaveAttribute(
      "href",
      /ranking-and-boosts\.html/,
    );
  });

  test("one broken example does not prevent its siblings from loading", async ({
    page,
  }) => {
    await page.route(
      "**/gallery/products/search-index/manifest.json",
      (route) => route.abort(),
    );
    await page.goto(`${baseUrl}gallery/index.html`);
    await expect(
      page.locator('[data-example-card="basic"] .gallery-error'),
    ).toBeVisible();
    await expect(
      page.locator('[data-example-card="synonyms"] .gallery-results-summary'),
    ).toContainText(/result/);
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
    await expect(page.locator(".gallery-hit-list li")).toHaveCount(4);
    await expect(
      page.locator(".gallery-facet-group:has-text('category')"),
    ).toBeVisible();
    await expect(page.locator(".gallery-search-input")).toHaveAttribute(
      "name",
      "gallery-search",
    );
    await expect(page.locator(".gallery-search-input")).toHaveAttribute(
      "autocomplete",
      "off",
    );
    await expect(page.locator(".gallery-search-input")).toHaveAttribute(
      "spellcheck",
      "false",
    );
  });

  test("checking a category facet filters results and updates counts", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}gallery/products/index.html`);
    await expect(page.locator(".gallery-hit-list li").first()).toBeVisible();
    const beforeHrefs = await page
      .locator(".gallery-hit-list li a")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")));

    await page
      .locator(
        ".gallery-facet-group:has-text('category') label:has-text(\"Furniture\")",
      )
      .locator("input")
      .check();

    await expect(async () => {
      const links = page.locator(".gallery-hit-list li a");
      const afterHrefs = await links.evaluateAll((items) =>
        items.map((item) => item.getAttribute("href")),
      );
      expect(afterHrefs.length).toBeGreaterThan(0);
      expect(afterHrefs.length).toBeLessThanOrEqual(4);
      expect(afterHrefs).not.toEqual(beforeHrefs);
    }).toPass();

    for (const title of await page
      .locator(".gallery-hit-title")
      .allTextContents()) {
      expect(title).not.toBe("");
    }
  });

  test("a numeric range facet filters results between inclusive bounds", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}gallery/products/index.html`);
    const hits = page.locator(".gallery-hit-list li");
    await expect(hits.first()).toBeVisible();
    expect(await hits.count()).toBeGreaterThan(0);

    await page.getByLabel("priceRange minimum").fill("50");
    await page.getByLabel("priceRange maximum").fill("120");

    await expect(hits.first()).toBeVisible();
    expect(await hits.count()).toBeGreaterThan(0);
    await expect(page.locator(".gallery-error")).toHaveCount(0);

    // Rechecking against the same demo across runs stays deterministic:
    // clearing the range restores the full set.
    await page.getByLabel("priceRange minimum").fill("");
    await page.getByLabel("priceRange maximum").fill("");
    await expect(hits).toHaveCount(4);
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

  test("a geo facet filters results within a radius and shows distance", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}gallery/products/index.html`);
    const hits = page.locator(".gallery-hit-list li");
    await expect(hits.first()).toBeVisible();

    // New York (40.7128, -74.0060) plus a small radius should only ever
    // surface products whose pickup store is New York itself, never one of
    // the other four pickup cities (each thousands of km away).
    await page.getByLabel("storeLocation latitude").fill("40.7128");
    await page.getByLabel("storeLocation longitude").fill("-74.006");
    await page.getByLabel("storeLocation radius in kilometers").fill("50");

    await expect(async () => {
      expect(await hits.count()).toBeGreaterThan(0);
      expect(await hits.count()).toBeLessThanOrEqual(4);
    }).toPass();
    await expect(page.locator(".gallery-error")).toHaveCount(0);
    for (const badge of await page
      .locator(".gallery-badge-distance")
      .allTextContents()) {
      expect(badge).toMatch(/km away/);
    }

    // Clearing the geo inputs restores the full default result set.
    await page.getByLabel("storeLocation latitude").fill("");
    await page.getByLabel("storeLocation longitude").fill("");
    await page.getByLabel("storeLocation radius in kilometers").fill("");
    await expect(hits).toHaveCount(4);
  });

  test("the geo minimap plots result locations and grows a radius ring once a filter is active", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}gallery/products/index.html`);
    await expect(page.locator(".gallery-hit-list li").first()).toBeVisible();

    // No geo filter yet, but the default result set's own stored locations
    // still plot -- the map fills from results whenever the field is
    // present, not only once a radius filter narrows things.
    await expect(page.locator(".gallery-geo-map")).toHaveCount(1);
    await expect(page.locator(".gallery-geo-map-radius")).toHaveCount(0);

    await page.getByLabel("storeLocation latitude").fill("40.7128");
    await page.getByLabel("storeLocation longitude").fill("-74.006");
    await page.getByLabel("storeLocation radius in kilometers").fill("50");

    await expect(page.locator(".gallery-geo-map-radius")).toHaveCount(1);
    await expect(page.locator(".gallery-geo-map-origin")).toHaveCount(1);
  });

  test('"Use my location" fills the coordinates from the device location and searches', async ({
    page,
    context,
  }) => {
    const origin = new URL(baseUrl).origin;
    await context.grantPermissions(["geolocation"], { origin });
    await context.setGeolocation({ latitude: 59.3293, longitude: 18.0686 });

    await page.goto(`${baseUrl}gallery/products/index.html`);
    await expect(page.locator(".gallery-hit-list li").first()).toBeVisible();

    await page.getByRole("button", { name: "Use my location" }).click();

    await expect(async () => {
      const lat = await page.getByLabel("storeLocation latitude").inputValue();
      const lon = await page.getByLabel("storeLocation longitude").inputValue();
      expect(Number(lat)).toBeCloseTo(59.3293, 3);
      expect(Number(lon)).toBeCloseTo(18.0686, 3);
    }).toPass();
    await expect(
      page.getByLabel("storeLocation radius in kilometers"),
    ).toHaveValue("500");
    await expect(page.locator(".gallery-error")).toHaveCount(0);
    await expect(page.locator(".gallery-geo-map-origin")).toHaveCount(1);
  });

  test("sort by distance reorders results nearest-first", async ({ page }) => {
    await page.goto(`${baseUrl}gallery/products/index.html`);
    await page.getByLabel("storeLocation latitude").fill("40.7128");
    await page.getByLabel("storeLocation longitude").fill("-74.006");
    await page.getByLabel("storeLocation radius in kilometers").fill("20000");
    await expect(page.locator(".gallery-hit-list li").first()).toBeVisible();

    await page.getByLabel("Sort by distance").check();

    await expect(async () => {
      const badges = await page
        .locator(".gallery-badge-distance")
        .allTextContents();
      expect(badges.length).toBeGreaterThan(0);
      const distances = badges.map((b) => Number.parseFloat(b));
      const sorted = [...distances].sort((a, b) => a - b);
      expect(distances).toEqual(sorted);
    }).toPass();
  });

  test("exact-match filter on the stored (not faceted) sku field finds one product", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}gallery/products/index.html`);
    await expect(page.locator(".gallery-hit-list li").first()).toBeVisible();

    await page.getByLabel("sku exact match").fill("SKU-00001");

    await expect(async () => {
      expect(await page.locator(".gallery-hit-list li").count()).toBe(1);
    }).toPass();
    await expect(page.locator(".gallery-hit-title").first()).toContainText(
      "Walnut Accent Table",
    );

    // Clearing the field restores the full default result set.
    await page.getByLabel("sku exact match").fill("");
    await expect(page.locator(".gallery-hit-list li")).toHaveCount(4);
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

    for (const [language, title] of [
      ["sv", "Espresso på svenska"],
      ["nl", "Espresso in het Nederlands"],
      ["nb", "Espresso på bokmål"],
      ["nn", "Espresso på nynorsk"],
    ] as const) {
      await page.locator(".gallery-language-select").selectOption(language);
      await expect(page.locator(".gallery-hit-list li")).toHaveCount(1);
      await expect(page.locator(".gallery-hit-title")).toContainText(title);
    }
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
