import { cp, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { I18nDoc } from "./gallery-i18n-data.js";
import { I18N_DOCS } from "./gallery-i18n-data.js";
import { escapeHtml, pageShell } from "./gallery-shared.js";
import type { PythonSourceDocument as SourceDocument } from "./python-index.js";
import { writePythonIndex } from "./python-index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "dist");
const galleryDir = join(distDir, "gallery", "i18n");
const searchIndexDir = join(galleryDir, "search-index");

function renderDocPage(doc: I18nDoc): string {
  const bodyHtml = `
      <main>
        <nav><a href="../index.html">&larr; Back to the multi-language demo</a></nav>
        <h1>${escapeHtml(doc.title)}</h1>
        <p>${escapeHtml(doc.body)}</p>
      </main>`;
  const html = pageShell({
    title: doc.title,
    description: doc.body,
    root: "../../../",
    bodyHtml,
  });
  // pageShell always emits <html lang="en"> -- override per doc so
  // extractDocument's language detection (docs/guides/internationalization.md)
  // actually partitions each page into its own language, not just en.
  return html.replace('<html lang="en">', `<html lang="${doc.language}">`);
}

function renderI18nIndexPage(): string {
  const bodyHtml = `
      <main>
        <p><a href="../../index.html">&larr; Back to docs</a></p>
        <h1>Multi-language corpus</h1>
        <p>${I18N_DOCS.length} short articles across English, German, Swedish,
        Dutch, Norwegian Bokmål, and Norwegian Nynorsk. "Espresso" is spelled
        identically in all six languages: pick a language below and search it
        to see that each language's index only ever returns its own
        page, not the other's. German's "schon" (already) and "schön"
        (beautiful) differ only by an umlaut -- searching either now finds
        both pages, since the real German stemmer's own final step folds
        any remaining umlaut back to a plain vowel
        (<a href="../../docs/guides/internationalization.html">internationalization
        &amp; i18n</a>), even though it reaches the stemmer as two
        distinct strings.</p>
        <div
          data-gallery-root
          data-index-path="gallery/i18n/search-index/manifest.json"
          data-default-query="espresso"
          data-languages="en,de,sv,nl,nb,nn"
        ></div>
      </main>`;
  return pageShell({
    title: "Multi-language corpus demo",
    description:
      "Articles in six languages demonstrating partitioning, stemming, and diacritic-sensitive matching.",
    root: "../../",
    bodyHtml,
    withWidget: true,
  });
}

function docToSource(doc: I18nDoc, id: number): SourceDocument {
  return {
    id,
    url: `/gallery/i18n/p/${doc.slug}.html`,
    html: renderDocPage(doc),
  };
}

async function main() {
  const sources = I18N_DOCS.map((doc, i) => docToSource(doc, i + 1));

  const { outDir, cleanup } = await writePythonIndex(sources, {
    defaultLanguage: "en",
  });
  await cp(outDir, searchIndexDir, { recursive: true });
  await cleanup();

  await mkdir(join(galleryDir, "p"), { recursive: true });
  for (const source of sources) {
    await writeFile(
      join(distDir, source.url.replace(/^\//, "")),
      source.html,
      "utf8",
    );
  }
  await writeFile(
    join(galleryDir, "index.html"),
    renderI18nIndexPage(),
    "utf8",
  );

  console.log(
    `built multi-language corpus demo: ${sources.length} pages -> ${galleryDir}`,
  );
}

main();
