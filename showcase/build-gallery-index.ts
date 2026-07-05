import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pageShell } from "./gallery-shared.js";

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
 * handful of gallery demos (docs/19-github-pages-showcase.md#stage-2--feature-gallery-needs-phases-2-5
 * lists four total), so a static list here is simpler than a
 * filesystem scan and keeps the ordering/copy under editorial control.
 */
const DEMOS: DemoLink[] = [
  {
    href: "products/index.html",
    title: "Product catalog",
    description:
      "64 synthetic products: terms facets, boosts, a pinned best-bet, and a fuzzy-matching toggle (typo tolerance).",
  },
  {
    href: "synonyms/index.html",
    title: "Synonym playground",
    description:
      "Non-overlapping vocabulary docs demonstrating synonym expansion, with matched-via-synonym results visibly labeled.",
  },
];

function renderHubPage(): string {
  const items = DEMOS.map(
    (demo) => `
        <li>
          <a href="${demo.href}">${demo.title}</a>
          <p>${demo.description}</p>
        </li>`,
  ).join("");
  const bodyHtml = `
      <main>
        <p><a href="../index.html">&larr; Back to docs</a></p>
        <h1>Feature gallery</h1>
        <p>Small, purpose-built demo corpora, each showcasing one part of
        the engine end to end with real indexed pages and a real
        <code>@csf/client</code>-powered search box -- not mocked.</p>
        <ul class="gallery-demo-list">${items}
        </ul>
      </main>`;
  return pageShell({
    title: "Feature gallery",
    description: "Demos of facets, boosts, pins, fuzzy matching, and synonyms.",
    root: "../",
    bodyHtml,
  });
}

async function main() {
  await writeFile(join(galleryDir, "index.html"), renderHubPage(), "utf8");
  console.log(`built gallery hub page -> ${join(galleryDir, "index.html")}`);
}

main();
