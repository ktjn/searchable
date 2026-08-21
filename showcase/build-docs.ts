import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { marked, type Tokens } from "marked";
import { DOC_SECTIONS, type DocPage } from "./docs-nav.js";
import {
  createMarkdownRenderer,
  flattenNavigation,
  renderSitePage,
  rewriteMarkdownLinks,
  type SitePage,
  validateNavigation,
} from "./docs-site.js";
import { resolveWidgetScript } from "./vite-manifest.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const outDir = join(__dirname, "dist");

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
    title: heading?.text ?? "Searchable",
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

async function renderPage(page: DocPage): Promise<SitePage> {
  const mdPath = join(repoRoot, page.source);
  const markdown = await readFile(mdPath, "utf8");
  const { excerpt } = extractTitleAndExcerpt(markdown);
  const bodyHtml = rewriteMarkdownLinks(
    await marked.parse(markdown, {
      gfm: true,
      renderer: createMarkdownRenderer(),
    }),
    page.source,
    DOC_SECTIONS,
  );
  return { ...page, excerpt, bodyHtml };
}

async function main() {
  // build:widget (vite.widget.config.ts) now runs first and is
  // responsible for starting from a clean dist/ (emptyOutDir: true) --
  // this step needs its manifest already on disk to resolve the
  // search-widget script's real hashed filename below.
  await mkdir(outDir, { recursive: true });
  const searchWidgetScript = await resolveWidgetScript(outDir, "search-widget");

  validateNavigation(DOC_SECTIONS);
  const navigation = flattenNavigation(DOC_SECTIONS);
  for (const page of navigation) {
    await access(join(repoRoot, page.source));
  }

  const homeMarkdown = await readFile(join(repoRoot, "README.md"), "utf8");
  const homeMetadata = extractTitleAndExcerpt(homeMarkdown);
  const home: SitePage = {
    source: "README.md",
    route: "index",
    title: homeMetadata.title,
    excerpt: homeMetadata.excerpt,
    bodyHtml: rewriteMarkdownLinks(
      await marked.parse(homeMarkdown, {
        gfm: true,
        renderer: createMarkdownRenderer(),
      }),
      "README.md",
      DOC_SECTIONS,
    ),
  };

  const pages: SitePage[] = [];
  for (const page of navigation) {
    pages.push(await renderPage(page));
  }

  const outputPages = [home, ...pages];
  for (const [index, page] of outputPages.entries()) {
    const outPath = join(outDir, `${page.route}.html`);
    await mkdir(dirname(outPath), { recursive: true });
    const navigationIndex = index - 1;
    const previous =
      navigationIndex > 0 ? navigation[navigationIndex - 1] : undefined;
    const next =
      navigationIndex >= 0 ? navigation[navigationIndex + 1] : undefined;
    await writeFile(
      outPath,
      renderSitePage(DOC_SECTIONS, page, previous, next, searchWidgetScript),
      "utf8",
    );
  }

  await cp(join(__dirname, "src", "style.css"), join(outDir, "style.css"));
  await cp(join(__dirname, "src", "gallery.css"), join(outDir, "gallery.css"));

  console.log(
    `rendered ${pages.length} curated documentation page(s) plus README home page -> ${outDir}`,
  );
}

main();
