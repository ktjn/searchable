import { describe, expect, test } from "vitest";
import { DOC_SECTIONS } from "../docs-nav.js";
import {
  flattenNavigation,
  highlightCode,
  renderSitePage,
  rewriteMarkdownLinks,
  validateNavigation,
} from "../docs-site.js";

describe("documentation navigation", () => {
  test("publishes the approved sections in order", () => {
    expect(DOC_SECTIONS.map((section) => section.title)).toEqual([
      "Getting started",
      "Guides",
      "Concepts",
      "Reference",
      "Project",
    ]);
  });

  test("contains no archived or internal source", () => {
    const pages = flattenNavigation(DOC_SECTIONS);
    expect(pages).toHaveLength(26);
    expect(pages.some((page) => /archive|superpowers/.test(page.source))).toBe(
      false,
    );
  });

  test("rejects duplicate routes", () => {
    const invalid = [
      {
        title: "A",
        pages: [
          { source: "docs/a.md", route: "docs/a", title: "A" },
          { source: "docs/b.md", route: "docs/a", title: "B" },
        ],
      },
    ];
    expect(() => validateNavigation(invalid)).toThrow(
      "Duplicate documentation route: docs/a",
    );
  });

  test("rewrites sibling and parent Markdown links for nested output", () => {
    expect(
      rewriteMarkdownLinks(
        '<a href="../reference/client-api.md#search">API</a>',
      ),
    ).toBe('<a href="../reference/client-api.html#search">API</a>');
  });

  test("rejects duplicate and forbidden sources", () => {
    expect(() =>
      validateNavigation([
        {
          title: "A",
          pages: [
            { source: "docs/a.md", route: "docs/a", title: "A" },
            { source: "docs/a.md", route: "docs/b", title: "B" },
          ],
        },
      ]),
    ).toThrow("Duplicate documentation source: docs/a.md");

    expect(() =>
      validateNavigation([
        {
          title: "A",
          pages: [
            {
              source: "docs/archive/a.md",
              route: "docs/a",
              title: "A",
            },
          ],
        },
      ]),
    ).toThrow("Unpublishable documentation source: docs/archive/a.md");
  });
});

describe("documentation rendering", () => {
  test("highlights registered languages at build time", () => {
    expect(highlightCode("typescript", "const count: number = 1;")).toContain(
      '<span class="hljs-keyword">const</span>',
    );
  });

  test("renders grouped navigation and previous and next links", () => {
    const pages = flattenNavigation(DOC_SECTIONS);
    const current = {
      ...pages[1],
      excerpt: "Install the package.",
      bodyHtml: "<h1>Installation</h1>",
    };
    const html = renderSitePage(DOC_SECTIONS, current, pages[0], pages[2]);

    expect(html).toContain("<h2>Getting started</h2>");
    expect(html).toContain(
      'href="../../docs/getting-started/installation.html" aria-current="page"',
    );
    expect(html).toContain(
      'class="previous" href="../../docs/getting-started/overview.html"',
    );
    expect(html).toContain(
      'class="next" href="../../docs/getting-started/first-search.html"',
    );
  });
});
