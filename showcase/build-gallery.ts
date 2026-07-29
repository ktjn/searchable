import { cp, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Product } from "./gallery-data.js";
import { generateProducts } from "./gallery-data.js";
import { escapeHtml, pageShell } from "./gallery-shared.js";
import type { PythonSourceDocument as SourceDocument } from "./python-index.js";
import { writePythonIndex } from "./python-index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "dist");
const galleryDir = join(distDir, "gallery", "products");
const searchIndexDir = join(galleryDir, "search-index");

const RETURNS_POLICY_ID = 1000;

function renderProductPage(product: Product): string {
  const bodyHtml = `
      <main>
        <nav><a href="../index.html">&larr; Back to the product catalog demo</a></nav>
        <h1>${escapeHtml(product.name)}</h1>
        <p class="gallery-meta">
          <span>${escapeHtml(product.category)}</span> ·
          <span>$${product.price}</span> ·
          <span>${escapeHtml(product.priceBucket)}</span>
        </p>
        <p>${escapeHtml(product.description)}</p>
        <p class="gallery-tags">
          ${product.tags.map((t) => `<span class="gallery-tag">${escapeHtml(t)}</span>`).join("\n          ")}
        </p>
      </main>`;
  const meta = [
    `<meta name="searchable-facet-category" content="${escapeHtml(product.category)}">`,
    `<meta name="searchable-facet-price" content="${escapeHtml(product.priceBucket)}">`,
    ...product.tags.map(
      (t) => `<meta name="searchable-facet-tags" content="${escapeHtml(t)}">`,
    ),
    ...(product.featured
      ? [`<meta name="searchable-boost" content="2.5">`]
      : []),
  ].join("\n    ");
  const html = pageShell({
    title: product.name,
    description: product.description,
    root: "../../../",
    bodyHtml,
  });
  // pageShell doesn't know about per-page facet/boost meta tags -- splice
  // them in right after the shared <meta name="description"> line rather
  // than threading a growing options bag through a template meant to be
  // shared with the (meta-tag-free) landing page.
  return html.replace(
    '<link rel="stylesheet" href="../../../style.css" />',
    `${meta}\n    <link rel="stylesheet" href="../../../style.css" />`,
  );
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
  const html = pageShell({
    title: "Returns Policy",
    description: "Our returns and refund policy.",
    root: "../../",
    bodyHtml,
  });
  return html.replace(
    '<link rel="stylesheet" href="../../style.css" />',
    `<meta name="searchable-pin" content="returns policy">\n    <link rel="stylesheet" href="../../style.css" />`,
  );
}

function renderGalleryIndexPage(products: Product[]): string {
  const categories = [...new Set(products.map((p) => p.category))].sort();
  const bodyHtml = `
      <main>
        <p><a href="../../index.html">&larr; Back to docs</a></p>
        <h1>Product catalog demo</h1>
        <p>${products.length} synthetic products across ${categories.join(
          ", ",
        )}, indexed with <code>@ktjn/searchable-indexer</code> and searched with
        <code>@ktjn/searchable-client</code> -- real facets, boosts, a pinned best-bet
        ("returns policy"), and typo-tolerant fuzzy matching, not a mock.
        See <a href="../../docs/guides/facets.html">faceted search</a>,
        <a href="../../docs/guides/ranking-and-boosts.html">ranking &amp;
        boosts</a>, and <a href="../../docs/guides/pinning.html">
        term-to-page pinning</a> for how each mechanism works.</p>
        <div
          data-gallery-root
          data-index-path="gallery/products/search-index/manifest.json"
          data-default-query="product"
          data-facets="category,price,tags"
          data-fuzzy-toggle="true"
        ></div>
      </main>`;
  return pageShell({
    title: "Product catalog demo",
    description:
      "A synthetic product catalog demonstrating facets, boosts, and pinning.",
    root: "../../",
    bodyHtml,
    withWidget: true,
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
  const products = generateProducts();
  const productSources = products.map(productToSource);
  const returnsPolicySource: SourceDocument = {
    id: RETURNS_POLICY_ID,
    url: "/gallery/products/returns-policy.html",
    html: renderReturnsPolicyPage(),
  };
  const sources = [...productSources, returnsPolicySource];

  const { outDir, cleanup } = await writePythonIndex(sources, {
    defaultLanguage: "en",
    fuzzy: true,
  });
  await cp(outDir, searchIndexDir, { recursive: true });
  await cleanup();

  await mkdir(join(galleryDir, "p"), { recursive: true });
  for (const source of productSources) {
    await writeFile(
      join(distDir, source.url.replace(/^\//, "")),
      source.html,
      "utf8",
    );
  }
  await writeFile(
    join(distDir, returnsPolicySource.url.replace(/^\//, "")),
    returnsPolicySource.html,
    "utf8",
  );
  await writeFile(
    join(galleryDir, "index.html"),
    renderGalleryIndexPage(products),
    "utf8",
  );

  console.log(
    `built product catalog demo: ${products.length} products + 1 support page -> ${galleryDir}`,
  );
}

main();
