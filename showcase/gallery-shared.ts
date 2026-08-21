/**
 * Shared page-shell helpers for every Stage 2 feature-gallery demo build
 * script (build-gallery.ts, build-gallery-synonyms.ts, ...) -- kept as a
 * standalone module rather than each script re-declaring it, since the
 * header/stylesheet/widget-script wiring must stay identical across
 * demos for gallery-widget.ts's site-root-relative asset resolution to
 * keep working regardless of which demo page loaded it.
 */

import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function pageShell(opts: {
  title: string;
  description: string;
  /** Path back to the site root (dist/), e.g. "../../" for a page two levels deep. */
  root: string;
  bodyHtml: string;
  withWidget?: boolean;
  /** Real, content-hashed filename for the "gallery-widget" entry (vite-manifest.ts against vite.widget.config.ts's build output). Required when withWidget is true. */
  galleryWidgetScript?: string;
  /** Extra `<meta>` lines for the head, emitted right after the description (e.g. per-doc facet/boost/pin tags). */
  meta?: string[];
  /** `<html lang>` value, defaulting to "en" (used by the i18n gallery to partition pages per language). */
  lang?: string;
}): string {
  const bodyHtml = opts.bodyHtml.replace(
    /<main(?=[\s>])(?:(?!\bid=)[^>])*?>/,
    (main) => main.replace("<main", '<main id="main-content"'),
  );
  if (opts.withWidget && !opts.galleryWidgetScript) {
    throw new Error(
      "pageShell({ withWidget: true }) requires galleryWidgetScript",
    );
  }
  const widgetScript = opts.withWidget
    ? `\n    <script type="module" src="${opts.root}${opts.galleryWidgetScript}"></script>`
    : "";
  const metaLines = opts.meta?.length
    ? `\n    ${opts.meta.join("\n    ")}`
    : "";
  return `<!doctype html>
<html lang="${opts.lang ?? "en"}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(opts.title)}</title>
    <meta name="description" content="${escapeHtml(opts.description)}" />${metaLines}
    <link rel="stylesheet" href="${opts.root}style.css" />
    <link rel="stylesheet" href="${opts.root}gallery.css" />
  </head>
  <body>
    <a class="skip-link" href="#main-content">Skip to content</a>
    <header>
      <a href="${opts.root}index.html" class="brand">Searchable</a>
      <a href="${opts.root}gallery/index.html">Feature gallery</a>
    </header>
    <div class="gallery-layout">
      ${bodyHtml}
    </div>${widgetScript}
  </body>
</html>
`;
}

export interface GalleryDemoBuild {
  /** Absolute `dist/gallery/<name>` directory for this demo. */
  galleryDir: string;
  /** Absolute site root (`dist/`). */
  distDir: string;
  /** Rendered pages, with site-root-relative urls like `/gallery/products/p/x.html`. */
  pages: Array<{ url: string; html: string }>;
  /** HTML for the demo's landing page, written to `galleryDir/index.html`. */
  indexHtml: string;
  /** Builds the demo's search index (shells out via writePythonIndex). */
  buildIndex: () => Promise<{
    outDir: string;
    cleanup: () => Promise<void>;
  }>;
  /** Human-readable completion message for the build log. */
  log: string;
}

/**
 * The shared Stage 2 feature-gallery build pipeline: every gallery demo
 * runs the same seven steps (build index via the Python indexer, copy it to
 * `search-index/`, write each rendered page, write the landing page),
 * previously re-implemented in each build-gallery*.ts script.
 */
export async function buildGalleryDemo({
  galleryDir,
  distDir,
  pages,
  indexHtml,
  buildIndex,
  log,
}: GalleryDemoBuild): Promise<void> {
  const { outDir, cleanup } = await buildIndex();
  await cp(outDir, join(galleryDir, "search-index"), { recursive: true });
  await cleanup();

  await mkdir(join(galleryDir, "p"), { recursive: true });
  for (const page of pages) {
    await writeFile(
      join(distDir, page.url.replace(/^\//, "")),
      page.html,
      "utf8",
    );
  }
  await writeFile(join(galleryDir, "index.html"), indexHtml, "utf8");
  console.log(log);
}
