import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { highlightCode } from "./docs-site.js";
import { escapeHtml, pageShell } from "./gallery-shared.js";
import {
  QUICK_EXAMPLES,
  renderExampleCode,
  renderRuntimeAttributes,
} from "./quick-examples.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "dist");
const galleryDir = join(distDir, "gallery");

interface DemoLink {
  href: string;
  title: string;
  description: string;
}

/**
 * Hardcoded rather than discovered from disk -- there are only ever a
 * handful of gallery demos (docs/archive/roadmaps/github-pages-showcase.md#stage-2--feature-gallery-needs-phases-2-5
 * lists four total), so a static list here is simpler than a
 * filesystem scan and keeps the ordering/copy under editorial control.
 */
const DEMOS: DemoLink[] = [
  {
    href: "products/index.html",
    title: "Product catalog",
    description:
      "64 synthetic products: terms and numeric range facets, boosts, a pinned best-bet, a fuzzy toggle with weight tuning, and vector/hybrid shards built with a deterministic embedder.",
  },
  {
    href: "synonyms/index.html",
    title: "Synonym playground",
    description:
      "Non-overlapping vocabulary docs demonstrating synonym expansion, with matched-via-synonym results visibly labeled, and selectable lexical/vector/hybrid retrieval.",
  },
  {
    href: "i18n/index.html",
    title: "Multi-language corpus",
    description:
      "Articles in six languages: language partitioning, Snowball stemming, and German diacritic-sensitive matching (schon vs. schön).",
  },
  {
    href: "../index.html",
    title: "Documentation search",
    description:
      "Search the complete curated documentation set with the same static index and browser client.",
  },
];

export function renderHubPage(): string {
  const demoLinks = DEMOS.map(
    (demo) => `
        <li>
          <a href="${escapeHtml(demo.href)}">${escapeHtml(demo.title)}</a>
          <p>${escapeHtml(demo.description)}</p>
        </li>`,
  ).join("");
  const quickCards = QUICK_EXAMPLES.map((example) => {
    const source = renderExampleCode(example);
    const highlightedSource = highlightCode("typescript", source);
    const headingId = `example-${example.id}`;
    return `
          <article class="quick-example-card" data-example-card="${escapeHtml(example.id)}" aria-labelledby="${headingId}">
            <h3 id="${headingId}">${escapeHtml(example.title)}</h3>
            <p>${escapeHtml(example.description)}</p>
            <div class="quick-example-widget"
              ${renderRuntimeAttributes(example)}
            ></div>
            <p class="quick-example-guide"><a class="example-guide" href="${escapeHtml(example.guideHref)}">Read the guide</a></p>
            <details class="example-source">
              <summary>View source</summary>
              <pre><code class="hljs language-typescript">${highlightedSource}</code></pre>
            </details>
          </article>`;
  }).join("");
  const bodyHtml = `
      <main>
        <p><a href="../index.html">&larr; Back to docs</a></p>
        <h1>Feature gallery</h1>
        <p>Small, purpose-built demo corpora, each showcasing one part of
        the engine end to end with real indexed pages and a real
        <code>@ktjn/searchable-client</code>-powered search box -- not mocked.</p>
        <section aria-labelledby="quick-examples">
          <h2 id="quick-examples">Try individual features</h2>
          <div class="quick-example-grid">${quickCards}
          </div>
        </section>
        <section aria-labelledby="full-demos">
          <h2 id="full-demos">Explore complete demos</h2>
          <ul class="gallery-demo-list">${demoLinks}
          </ul>
        </section>
      </main>`;
  return pageShell({
    title: "Feature gallery",
    description:
      "Demos of facets, boosts, pins, fuzzy matching, synonyms, highlighting, and vector/hybrid search.",
    root: "../",
    bodyHtml,
    withWidget: true,
  });
}

async function main() {
  await writeFile(join(galleryDir, "index.html"), renderHubPage(), "utf8");
  console.log(`built gallery hub page -> ${join(galleryDir, "index.html")}`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main();
}
