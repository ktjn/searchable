import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Product } from "./gallery-data.js";
import { generateProducts } from "./gallery-data.js";
import { buildGalleryDemo, escapeHtml, pageShell } from "./gallery-shared.js";
import type { PythonSourceDocument as SourceDocument } from "./python-index.js";
import { writePythonIndex } from "./python-index.js";
import { resolveWidgetScript } from "./vite-manifest.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "dist");
const galleryDir = join(distDir, "gallery", "products");

const RETURNS_POLICY_ID = 1000;

function renderProductPage(product: Product): string {
  const bodyHtml = `
      <main>
        <nav><a href="../index.html">&larr; Back to the product catalog demo</a></nav>
        <h1>${escapeHtml(product.name)}</h1>
        <p class="gallery-meta">
          <span>${escapeHtml(product.category)}</span> ·
          <span>$${product.price}</span> ·
          <span>${escapeHtml(product.priceBucket)}</span> ·
          <span>Pickup: ${escapeHtml(product.storeName)}</span> ·
          <span>SKU: ${escapeHtml(product.sku)}</span>
        </p>
        <p>${escapeHtml(product.description)}</p>
        <p class="gallery-tags">
          ${product.tags.map((t) => `<span class="gallery-tag">${escapeHtml(t)}</span>`).join("\n          ")}
        </p>
      </main>`;
  return pageShell({
    title: product.name,
    description: product.description,
    root: "../../../",
    bodyHtml,
    meta: [
      `<meta name="searchable-facet-category" content="${escapeHtml(product.category)}">`,
      `<meta name="searchable-facet-price" content="${escapeHtml(product.priceBucket)}">`,
      `<meta name="searchable-facet-range-priceRange" content="${product.price}">`,
      `<meta name="searchable-facet-geo-storeLocation" content="${product.storeLocation.lat},${product.storeLocation.lon}">`,
      `<meta name="searchable-stored-sku" content="${escapeHtml(product.sku)}">`,
      ...product.tags.map(
        (t) => `<meta name="searchable-facet-tags" content="${escapeHtml(t)}">`,
      ),
      ...(product.featured
        ? [`<meta name="searchable-boost" content="2.5">`]
        : []),
    ],
  });
}

function renderReturnsPolicyPage(): string {
  const bodyHtml = `
      <main>
        <nav><a href="index.html">&larr; Back to the product catalog demo</a></nav>
        <h1>Returns Policy</h1>
        <p>Unused items may be returned within 30 days of delivery for a
        full refund. Opened electronics can be exchanged for a
        replacement of the same model within 14 days. Custom or
        made-to-order furniture is final sale.</p>
      </main>`;
  return pageShell({
    title: "Returns Policy",
    description: "Our returns and refund policy.",
    root: "../../",
    bodyHtml,
    meta: ['<meta name="searchable-pin" content="returns policy">'],
  });
}

function renderGalleryIndexPage(
  products: Product[],
  galleryWidgetScript: string,
): string {
  const categories = [...new Set(products.map((p) => p.category))].sort();
  const bodyHtml = `
      <main>
        <p><a href="../../index.html">&larr; Back to docs</a></p>
        <h1>Product catalog demo</h1>
        <p>${products.length} synthetic products across ${categories.join(
          ", ",
        )}, indexed with the Python <code>searchable-indexer</code> and searched with
        <code>@ktjn/searchable</code> -- real terms, numeric range, and geo
        facets, boosts, a pinned best-bet ("returns policy"), typo-tolerant
        fuzzy matching, and exact-match filtering on a stored (not faceted)
        SKU field.
        See <a href="../../docs/guides/facets.html">faceted search</a>
        (including <a href="../../docs/guides/facets.html#geo-facets">geo
        facets</a> and
        <a href="../../docs/guides/facets.html#exact-match-on-stored-fields">
        exact match on stored fields</a>),
        <a href="../../docs/guides/ranking-and-boosts.html">ranking &amp;
        boosts</a>, and <a href="../../docs/guides/pinning.html">
        term-to-page pinning</a> for how each mechanism works.</p>
        <div
          data-gallery-root
          data-index-path="gallery/products/search-index/manifest.json"
          data-default-query="product"
          data-facets="category,price,tags"
          data-range-facets="priceRange"
          data-geo-facet="storeLocation"
          data-exact-fields="sku"
          data-fuzzy-toggle="true"
          data-fuzzy-weight="0.5"
           data-modes="lexical"
        ></div>
      </main>`;
  return pageShell({
    title: "Product catalog demo",
    description:
      "A synthetic product catalog demonstrating facets (including geo and exact-match), boosts, and pinning.",
    root: "../../",
    bodyHtml,
    withWidget: true,
    galleryWidgetScript,
  });
}

function productToSource(product: Product): SourceDocument {
  return {
    id: product.id,
    url: `/gallery/products/p/${product.slug}.html`,
    html: renderProductPage(product),
  };
}

async function main() {
  const galleryWidgetScript = await resolveWidgetScript(
    distDir,
    "gallery-widget",
  );
  const products = generateProducts();
  const productSources = products.map(productToSource);
  const returnsPolicySource: SourceDocument = {
    id: RETURNS_POLICY_ID,
    url: "/gallery/products/returns-policy.html",
    html: renderReturnsPolicyPage(),
  };
  const sources = [...productSources, returnsPolicySource];

  await buildGalleryDemo({
    galleryDir,
    distDir,
    pages: [...productSources, returnsPolicySource],
    indexHtml: renderGalleryIndexPage(products, galleryWidgetScript),
    buildIndex: () =>
      writePythonIndex(sources, {
        defaultLanguage: "en",
        fuzzy: true,
      }),
    log: `built product catalog demo: ${products.length} products + 1 support page -> ${galleryDir}`,
  });
}

main();
