import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Tokens, marked } from "marked";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const outDir = join(__dirname, "dist");

interface Page {
  /** e.g. "index" or "docs/00-overview" */
  slug: string;
  title: string;
  excerpt: string;
  bodyHtml: string;
}

function extractTitleAndExcerpt(markdown: string): {
  title: string;
  excerpt: string;
} {
  const tokens = marked.lexer(markdown);
  const heading = tokens.find(
    (t): t is Tokens.Heading => t.type === "heading" && t.depth === 1,
  );
  const paragraph = tokens.find(
    (t): t is Tokens.Paragraph => t.type === "paragraph",
  );
  return {
    title: heading?.text ?? "client-search-framework",
    excerpt: paragraph
      ? paragraph.text
          .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // [text](link) -> text
          .replace(/[*_`]/g, "") // strip emphasis/inline-code markers
          .replace(/\s+/g, " ") // collapse newlines/whitespace
          .trim()
          .slice(0, 200)
      : "",
  };
}

/**
 * Cross-references between docs are authored as plain markdown links
 * to sibling .md files (correct for GitHub's own rendering) — rewrite
 * them to the .html pages this build actually produces.
 */
function rewriteMarkdownLinks(html: string): string {
  return html.replace(
    /href="([^"]*?)\.md(#[^"]*)?"/g,
    (_match, path: string, hash = "") => `href="${path}.html${hash}"`,
  );
}

async function renderPage(mdPath: string, slug: string): Promise<Page> {
  const markdown = await readFile(mdPath, "utf8");
  const { title, excerpt } = extractTitleAndExcerpt(markdown);
  const bodyHtml = rewriteMarkdownLinks(
    await marked.parse(markdown, { gfm: true }),
  );
  return { slug, title, excerpt, bodyHtml };
}

function depthPrefix(slug: string): string {
  const depth = slug.split("/").length - 1;
  return depth === 0 ? "./" : "../".repeat(depth);
}

function renderNav(pages: Page[], currentSlug: string): string {
  const items = pages
    .map((p) => {
      const href = `${depthPrefix(currentSlug)}${p.slug}.html`;
      const active = p.slug === currentSlug ? ' aria-current="page"' : "";
      return `<li><a href="${href}"${active}>${escapeHtml(p.title)}</a></li>`;
    })
    .join("\n      ");
  return `<ul>\n      ${items}\n    </ul>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtml(page: Page, pages: Page[]): string {
  const root = depthPrefix(page.slug);
  // Kept as just the page's own title (no site-name suffix): this is
  // also what the indexer stores as the searchable title, and a
  // "Overview — client-search-framework" repeated on every search
  // result row would be noise — the header/logo already carries the
  // site branding visually.
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(page.title)}</title>
    <meta name="description" content="${escapeHtml(page.excerpt)}" />
    <link rel="stylesheet" href="${root}style.css" />
  </head>
  <body>
    <header>
      <a href="${root}index.html" class="brand">client-search-framework</a>
      <div id="search-root" data-search-root></div>
    </header>
    <div class="layout">
      <nav>
        ${renderNav(pages, page.slug)}
      </nav>
      <main>
        ${page.bodyHtml}
      </main>
    </div>
    <script type="module" src="${root}search-widget.js"></script>
  </body>
</html>
`;
}

async function discoverDocPages(): Promise<{ mdPath: string; slug: string }[]> {
  const docsDir = join(repoRoot, "docs");
  const entries = (await readdir(docsDir))
    .filter((f) => f.endsWith(".md"))
    .sort();
  return entries.map((f) => ({
    mdPath: join(docsDir, f),
    slug: `docs/${f.replace(/\.md$/, "")}`,
  }));
}

async function main() {
  // Always the first build step, so it's responsible for starting from
  // a clean dist/ (build-search.ts adds to it afterwards).
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const docPages = await discoverDocPages();
  const sources: { mdPath: string; slug: string }[] = [
    { mdPath: join(repoRoot, "README.md"), slug: "index" },
    ...docPages,
  ];

  const pages: Page[] = [];
  for (const source of sources) {
    pages.push(await renderPage(source.mdPath, source.slug));
  }

  for (const page of pages) {
    const outPath = join(outDir, `${page.slug}.html`);
    await mkdir(dirname(outPath), { recursive: true });
    // nav excludes the home page itself to keep the sidebar focused on docs
    const navPages = pages.filter((p) => p.slug !== "index");
    await writeFile(outPath, renderHtml(page, navPages), "utf8");
  }

  await cp(join(__dirname, "src", "style.css"), join(outDir, "style.css"));

  console.log(`rendered ${pages.length} page(s) -> ${outDir}`);
}

main();
