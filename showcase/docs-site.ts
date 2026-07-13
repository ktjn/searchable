import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import typescript from "highlight.js/lib/languages/typescript";
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

export function rewriteMarkdownLinks(html: string): string {
  return html.replace(
    /href="([^"]*?)\.md(#[^"]*)?"/g,
    (_match, path: string, hash = "") => `href="${path}.html${hash}"`,
  );
}

export function highlightCode(language: string, source: string): string {
  if (!hljs.getLanguage(language)) {
    return escapeHtml(source);
  }
  return hljs.highlight(source, { language }).value;
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
