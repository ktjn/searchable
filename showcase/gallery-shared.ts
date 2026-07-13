/**
 * Shared page-shell helpers for every Stage 2 feature-gallery demo build
 * script (build-gallery.ts, build-gallery-synonyms.ts, ...) -- kept as a
 * standalone module rather than each script re-declaring it, since the
 * header/stylesheet/widget-script wiring must stay identical across
 * demos for gallery-widget.ts's site-root-relative asset resolution to
 * keep working regardless of which demo page loaded it.
 */

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
}): string {
  const bodyHtml = opts.bodyHtml.replace(
    /<main(?=[\s>])(?:(?!\bid=)[^>])*?>/,
    (main) => main.replace("<main", '<main id="main-content"'),
  );
  const widgetScript = opts.withWidget
    ? `\n    <script type="module" src="${opts.root}gallery-widget.js"></script>`
    : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(opts.title)}</title>
    <meta name="description" content="${escapeHtml(opts.description)}" />
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
