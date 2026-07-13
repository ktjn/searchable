import { posix } from "node:path";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import typescript from "highlight.js/lib/languages/typescript";
import { Renderer } from "marked";
import type { DocPage, DocSection } from "./docs-nav.js";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("python", python);

export interface SitePage extends DocPage {
  excerpt: string;
  bodyHtml: string;
}

export function flattenNavigation(sections: readonly DocSection[]): DocPage[] {
  return sections.flatMap((section) => section.pages);
}

export function validateNavigation(sections: readonly DocSection[]): void {
  const routes = new Set<string>();
  const sources = new Set<string>();
  for (const page of flattenNavigation(sections)) {
    if (/^docs\/(archive|superpowers)\//.test(page.source)) {
      throw new Error(`Unpublishable documentation source: ${page.source}`);
    }
    if (routes.has(page.route)) {
      throw new Error(`Duplicate documentation route: ${page.route}`);
    }
    if (sources.has(page.source)) {
      throw new Error(`Duplicate documentation source: ${page.source}`);
    }
    routes.add(page.route);
    sources.add(page.source);
  }
}

const GITHUB_REPOSITORY_ROOT =
  "https://github.com/ktjn/client-search-framework";

function isExternalLink(path: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith("//");
}

function resolveRepoPath(currentSource: string, path: string): string {
  const sourceDirectory = posix.dirname(currentSource);
  const target = path.startsWith("/")
    ? posix.normalize(path.slice(1))
    : posix.normalize(posix.join(sourceDirectory, path));
  if (target === ".." || target.startsWith("../") || posix.isAbsolute(target)) {
    const kind = path.endsWith(".md") ? "Markdown" : "Repository";
    throw new Error(`${kind} link escapes repository: ${path}`);
  }
  return target;
}

function splitReference(reference: string): { path: string; suffix: string } {
  const suffixIndex = reference.search(/[?#]/);
  if (suffixIndex === -1) return { path: reference, suffix: "" };
  return {
    path: reference.slice(0, suffixIndex),
    suffix: reference.slice(suffixIndex),
  };
}

export function rewriteMarkdownLinks(
  html: string,
  currentSource: string,
  sections: readonly DocSection[],
): string {
  const pages = flattenNavigation(sections);
  return html.replace(
    /\b(href|src)=(["'])(.*?)\2/g,
    (match, attribute: string, quote: string, reference: string) => {
      if (
        !reference ||
        reference.startsWith("#") ||
        reference.startsWith("?") ||
        isExternalLink(reference)
      ) {
        return match;
      }

      const { path, suffix } = splitReference(reference);
      const targetSource = resolveRepoPath(currentSource, path);
      if (path.toLowerCase().endsWith(".html")) return match;

      const targetPage = pages.find((page) => page.source === targetSource);
      if (targetPage) {
        const currentRoute =
          pages.find((page) => page.source === currentSource)?.route ??
          currentSource.replace(/\.md$/, "");
        const targetRoute = posix.relative(
          posix.dirname(currentRoute),
          targetPage.route,
        );
        return `${attribute}=${quote}${targetRoute}.html${suffix}${quote}`;
      }

      const sourceKind = path.endsWith("/") ? "tree" : "blob";
      return `${attribute}=${quote}${GITHUB_REPOSITORY_ROOT}/${sourceKind}/main/${targetSource}${suffix}${quote}`;
    },
  );
}

export function highlightCode(language: string, source: string): string {
  if (!hljs.getLanguage(language)) {
    return escapeHtml(source);
  }
  return hljs.highlight(source, { language }).value;
}

function headingSlug(text: string): string {
  return (
    text
      .trim()
      .toLocaleLowerCase("en")
      .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
      .replace(/[\s-]+/g, "-")
      .replace(/^-|-$/g, "") || "section"
  );
}

export function createMarkdownRenderer(): Renderer {
  const renderer = new Renderer();
  const slugCounts = new Map<string, number>();

  renderer.code = ({ text, lang }) => {
    const language = lang?.trim().split(/\s+/)[0] ?? "";
    const languageClass = language.replace(/[^\w-]/g, "");
    const classes = languageClass ? `hljs language-${languageClass}` : "hljs";
    return `<pre><code class="${classes}">${highlightCode(language, text)}</code></pre>\n`;
  };

  renderer.heading = function ({ depth, text, tokens }) {
    const baseSlug = headingSlug(text);
    const count = slugCounts.get(baseSlug) ?? 0;
    slugCounts.set(baseSlug, count + 1);
    const slug = count === 0 ? baseSlug : `${baseSlug}-${count}`;
    return `<h${depth} id="${slug}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
  };

  return renderer;
}

function depthPrefix(route: string): string {
  const depth = route.split("/").length - 1;
  return depth === 0 ? "./" : "../".repeat(depth);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderNavigation(
  sections: readonly DocSection[],
  currentRoute: string,
): string {
  const root = depthPrefix(currentRoute);
  return sections
    .map((section) => {
      const pages = section.pages
        .map((page) => {
          const current =
            page.route === currentRoute ? ' aria-current="page"' : "";
          return `<li><a href="${root}${page.route}.html"${current}>${escapeHtml(page.title)}</a></li>`;
        })
        .join("\n          ");
      return `<section class="nav-section">
        <h2>${escapeHtml(section.title)}</h2>
        <ul>
          ${pages}
        </ul>
      </section>`;
    })
    .join("\n      ");
}

function renderPagerLink(
  className: "previous" | "next",
  page: DocPage | undefined,
  root: string,
): string {
  if (!page) return "";
  const label = className === "previous" ? "Previous" : "Next";
  return `<a class="${className}" href="${root}${page.route}.html"><span>${label}</span>${escapeHtml(page.title)}</a>`;
}

export function renderSitePage(
  sections: readonly DocSection[],
  current: SitePage,
  previous: DocPage | undefined,
  next: DocPage | undefined,
): string {
  const root = depthPrefix(current.route);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(current.title)}</title>
    <meta name="description" content="${escapeHtml(current.excerpt)}" />
    <link rel="stylesheet" href="${root}style.css" />
  </head>
  <body>
    <header>
      <a href="${root}index.html" class="brand">client-search-framework</a>
      <a href="${root}gallery/products/index.html">Feature gallery</a>
      <div id="search-root" data-search-root></div>
    </header>
    <div class="layout">
      <nav aria-label="Documentation">
        ${renderNavigation(sections, current.route)}
      </nav>
      <main>
        ${current.bodyHtml}
        <nav class="page-navigation" aria-label="Documentation pages">
          ${renderPagerLink("previous", previous, root)}
          ${renderPagerLink("next", next, root)}
        </nav>
      </main>
    </div>
    <script type="module" src="${root}search-widget.js"></script>
  </body>
</html>
`;
}
