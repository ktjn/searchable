import { readFile } from "node:fs/promises";
import { marked } from "marked";
import { describe, expect, test } from "vitest";
import { DOC_SECTIONS } from "../docs-nav.js";
import {
  createMarkdownRenderer,
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
    expect(pages).toHaveLength(27);
    expect(pages).toContainEqual({
      source: "docs/project/relevance-baselines.md",
      route: "docs/project/relevance-baselines",
      title: "Relevance baselines",
    });
    expect(pages).toContainEqual({
      source: "docs/project/performance-baseline.md",
      route: "docs/project/performance-baseline",
      title: "Performance baseline",
    });
    expect(pages.some((page) => /archive|superpowers/.test(page.source))).toBe(
      false,
    );
  });

  test("rejects duplicate routes", () => {
    const invalid = [
      {
        title: "A",
        pages: [
          { source: "docs/guides/a.md", route: "docs/a", title: "A" },
          { source: "docs/guides/b.md", route: "docs/a", title: "B" },
        ],
      },
    ];
    expect(() => validateNavigation(invalid)).toThrow(
      "Duplicate documentation route: docs/a",
    );
  });

  test("rejects sources outside the approved documentation roots", () => {
    const invalid = [
      {
        title: "A",
        pages: [{ source: "README.md", route: "docs/readme", title: "README" }],
      },
    ];
    expect(() => validateNavigation(invalid)).toThrow(
      "Documentation source outside approved sections: README.md",
    );

    expect(() =>
      validateNavigation([
        {
          title: "A",
          pages: [
            {
              source: "docs/guides/../archive/a.md",
              route: "docs/a",
              title: "A",
            },
          ],
        },
      ]),
    ).toThrow(
      "Documentation source outside approved sections: docs/guides/../archive/a.md",
    );
  });

  test("rejects duplicate visible document titles", () => {
    const invalid = [
      {
        title: "A",
        pages: [
          { source: "docs/guides/a.md", route: "docs/a", title: "Same" },
          { source: "docs/reference/b.md", route: "docs/b", title: "Same" },
        ],
      },
    ];
    expect(() => validateNavigation(invalid)).toThrow(
      "Duplicate documentation title: Same",
    );
  });

  test("rewrites sibling and parent Markdown links for nested output", () => {
    expect(
      rewriteMarkdownLinks(
        '<a href="../reference/client-api.md#search">API</a>',
        "docs/guides/indexing.md",
        DOC_SECTIONS,
      ),
    ).toBe('<a href="../reference/client-api.html#search">API</a>');
  });

  test("links archived Markdown to its canonical GitHub source", () => {
    expect(
      rewriteMarkdownLinks(
        '<a href="../archive/roadmaps/implementation-history.md">History</a>',
        "docs/project/roadmap.md",
        DOC_SECTIONS,
      ),
    ).toBe(
      '<a href="https://github.com/ktjn/searchable/blob/main/docs/archive/roadmaps/implementation-history.md">History</a>',
    );
  });

  test("links root Markdown to its canonical GitHub source", () => {
    expect(
      rewriteMarkdownLinks(
        '<a href="../../CHANGELOG.md">Changelog</a>',
        "docs/adr/0002-json-first-index-format.md",
        DOC_SECTIONS,
      ),
    ).toBe(
      '<a href="https://github.com/ktjn/searchable/blob/main/CHANGELOG.md">Changelog</a>',
    );
  });

  test("preserves fragments on canonical GitHub source links", () => {
    expect(
      rewriteMarkdownLinks(
        '<a href="../archive/specs/plugin-api.md#registration">Draft</a>',
        "docs/adr/0005-plugin-opt-in-boundary.md",
        DOC_SECTIONS,
      ),
    ).toBe(
      '<a href="https://github.com/ktjn/searchable/blob/main/docs/archive/specs/plugin-api.md#registration">Draft</a>',
    );
  });

  test("keeps manifest targets on local generated routes", () => {
    expect(
      rewriteMarkdownLinks(
        '<a href="../project/roadmap.md#status">Roadmap</a>',
        "docs/reference/client-api.md",
        DOC_SECTIONS,
      ),
    ).toBe('<a href="../project/roadmap.html#status">Roadmap</a>');
  });

  test("rejects Markdown links that escape the repository", () => {
    expect(() =>
      rewriteMarkdownLinks(
        '<a href="../../../outside.md">Outside</a>',
        "docs/guides/indexing.md",
        DOC_SECTIONS,
      ),
    ).toThrow("Markdown link escapes repository: ../../../outside.md");
  });

  test("links repository directories to their canonical GitHub trees", () => {
    expect(
      rewriteMarkdownLinks(
        '<a href="../../spec/examples/?format=json#basic">Examples</a>',
        "docs/adr/0002-json-first-index-format.md",
        DOC_SECTIONS,
      ),
    ).toBe(
      '<a href="https://github.com/ktjn/searchable/tree/main/spec/examples/?format=json#basic">Examples</a>',
    );
    expect(
      rewriteMarkdownLinks(
        '<a href="../../spec/schema/">Schema</a>',
        "docs/concepts/index-format.md",
        DOC_SECTIONS,
      ),
    ).toBe(
      '<a href="https://github.com/ktjn/searchable/tree/main/spec/schema/">Schema</a>',
    );
  });

  test("links repository files without extensions to canonical GitHub blobs", () => {
    expect(
      rewriteMarkdownLinks(
        '<a href="LICENSE">MIT</a>',
        "README.md",
        DOC_SECTIONS,
      ),
    ).toBe(
      '<a href="https://github.com/ktjn/searchable/blob/main/LICENSE">MIT</a>',
    );
  });

  test("rewrites local repository src attributes and preserves suffixes", () => {
    expect(
      rewriteMarkdownLinks(
        '<img src="../../spec/schema/manifest.schema.json?raw=1#shape">',
        "docs/concepts/index-format.md",
        DOC_SECTIONS,
      ),
    ).toBe(
      '<img src="https://github.com/ktjn/searchable/blob/main/spec/schema/manifest.schema.json?raw=1#shape">',
    );
  });

  test("keeps explicit generated HTML and fragment-only links local", () => {
    const html =
      '<a href="../reference/client-api.html#search">API</a><a href="#configuration">Config</a>';
    expect(
      rewriteMarkdownLinks(html, "docs/guides/indexing.md", DOC_SECTIONS),
    ).toBe(html);
  });

  test("leaves external and protocol-relative links unchanged", () => {
    const html =
      '<a href="https://example.com/spec/">Spec</a><script src="//cdn.example.com/widget.js"></script>';
    expect(rewriteMarkdownLinks(html, "README.md", DOC_SECTIONS)).toBe(html);
  });

  test("rejects non-Markdown links that escape the repository", () => {
    expect(() =>
      rewriteMarkdownLinks(
        '<a href="../../../outside/">Outside</a>',
        "docs/guides/indexing.md",
        DOC_SECTIONS,
      ),
    ).toThrow("Repository link escapes repository: ../../../outside/");
  });

  test("rejects duplicate and forbidden sources", () => {
    expect(() =>
      validateNavigation([
        {
          title: "A",
          pages: [
            { source: "docs/guides/a.md", route: "docs/a", title: "A" },
            { source: "docs/guides/a.md", route: "docs/b", title: "B" },
          ],
        },
      ]),
    ).toThrow("Duplicate documentation source: docs/guides/a.md");

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
    ).toThrow(
      "Documentation source outside approved sections: docs/archive/a.md",
    );
  });
});

describe("documentation rendering", () => {
  test("publishes the reviewed CMS-2k performance baseline", async () => {
    const source = await readFile(
      new URL("../../docs/project/performance-baseline.md", import.meta.url),
      "utf8",
    );
    const html = await marked.parse(source, {
      renderer: createMarkdownRenderer(),
    });

    expect(html).toContain("CMS-2k Chromium vertical baseline");
    expect(html).toContain("pnpm benchmark:baseline");
    expect(html).toContain("pnpm benchmark:render");
    expect(html).toContain("reviewed-baseline.json");
    expect(html).toContain("fresh Chromium context");
    expect(html).toContain("Warm search");
    expect(html).toContain("p50");
    expect(html).toContain("p95");
    expect(html).toContain("gzip-equivalent");
    expect(html).toContain("Heap status");
    expect(html).toContain("not a performance budget");
    expect(html).toContain("not a supported operating range");
    expect(html).toContain("multiple corpus sizes");
  });

  test("publishes the reviewed documentation-domain baseline", async () => {
    const source = await readFile(
      new URL("../../docs/project/relevance-baselines.md", import.meta.url),
      "utf8",
    );
    const html = await marked.parse(source, {
      renderer: createMarkdownRenderer(),
    });

    expect(html).toContain("pnpm relevance -- --suite searchable-docs");
    expect(html).toContain("pnpm relevance -- --suite govuk-learn-to-drive");
    expect(html).toContain(
      "pnpm relevance:refresh -- --suite govuk-learn-to-drive --check",
    );
    expect(html).toContain("source-credit audit");
    expect(html).toContain("not a pass/fail threshold");
  });

  test("renders stable unique heading IDs", async () => {
    const html = await marked.parse(
      "# Index format compatibility\n\n## Café & API!\n\n## Café & API!",
      { renderer: createMarkdownRenderer() },
    );

    expect(html).toContain('<h1 id="index-format-compatibility">');
    expect(html).toContain('<h2 id="café-api">');
    expect(html).toContain('<h2 id="café-api-1">');
  });

  test("avoids collisions with explicitly suffixed headings", async () => {
    const html = await marked.parse("# A\n\n# A-1\n\n# A", {
      renderer: createMarkdownRenderer(),
    });

    expect(html.match(/<h1 id="([^"]+)"/g)).toEqual([
      '<h1 id="a"',
      '<h1 id="a-1"',
      '<h1 id="a-2"',
    ]);
  });

  test("builds heading IDs from visible inline text", async () => {
    const html = await marked.parse(
      "# [Linked heading](https://example.com)\n\n## **Bold** and `code`",
      { renderer: createMarkdownRenderer() },
    );

    expect(html).toContain('<h1 id="linked-heading">');
    expect(html).toContain('<h2 id="bold-and-code">');
  });

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
    expect(html).toContain(
      'href="../../gallery/index.html">Feature gallery</a>',
    );
    expect(html).toContain('<a class="skip-link" href="#main-content">');
    expect(html).toContain('<main id="main-content">');
  });
});
