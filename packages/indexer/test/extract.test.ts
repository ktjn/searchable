import { describe, expect, it, vi } from "vitest";
import { extractDocument } from "../src/extract.js";

describe("extractDocument", () => {
  it("extracts title, language, and main content by default", () => {
    const html = `
      <html lang="de">
        <head><title>Preise</title></head>
        <body>
          <nav>Home | About</nav>
          <main><h1>Preise</h1><p>Unsere Preise sind einfach.</p></main>
          <footer>copyright</footer>
        </body>
      </html>`;
    const doc = extractDocument(html, "/pricing");
    expect(doc.title).toBe("Preise");
    expect(doc.language).toBe("de");
    expect(doc.body).toBe("Preise Unsere Preise sind einfach.");
    expect(doc.body).not.toContain("Home");
    expect(doc.body).not.toContain("copyright");
    expect(doc.noindex).toBe(false);
  });

  it("falls back to a configurable default language, not a hardcoded 'en'", () => {
    const html =
      "<html><head><title>Ohne Lang</title></head><body>x</body></html>";
    expect(extractDocument(html, "/x").language).toBe("en"); // default default
    expect(extractDocument(html, "/x", "de").language).toBe("de");
  });

  it("respects searchable-noindex", () => {
    const html = `<html><head><title>Draft</title><meta name="searchable-noindex"></head><body>x</body></html>`;
    expect(extractDocument(html, "/draft").noindex).toBe(true);
  });

  it("respects canonical link and meta description", () => {
    const html = `
      <html><head>
        <title>Pricing</title>
        <link rel="canonical" href="https://example.com/pricing">
        <meta name="description" content="Simple pricing.">
      </head><body><main>content</main></body></html>`;
    const doc = extractDocument(html, "/pricing-draft");
    expect(doc.url).toBe("https://example.com/pricing");
    expect(doc.excerpt).toBe("Simple pricing.");
  });

  it("respects data-searchable-body as an explicit content boundary", () => {
    const html = `
      <html><body>
        <main>ignored default region</main>
        <div data-searchable-body>the real content</div>
      </body></html>`;
    expect(extractDocument(html, "/x").body).toBe("the real content");
  });

  it("falls back to body minus boilerplate when no <main> is present", () => {
    const html = `
      <html><body>
        <header>site header</header>
        <p>actual page content</p>
        <footer>site footer</footer>
      </body></html>`;
    expect(extractDocument(html, "/x").body).toBe("actual page content");
  });

  it("defaults boost to 1.0 when searchable-boost is absent", () => {
    const html =
      "<html><head><title>Normal</title></head><body>x</body></html>";
    expect(extractDocument(html, "/x").boost).toBe(1.0);
  });

  it("parses searchable-boost", () => {
    const html = `<html><head><title>Featured</title><meta name="searchable-boost" content="2.5"></head><body>x</body></html>`;
    expect(extractDocument(html, "/x").boost).toBe(2.5);
  });

  it("ignores a malformed searchable-boost and falls back to 1.0", () => {
    const html = `<html><head><title>Bad</title><meta name="searchable-boost" content="not-a-number"></head><body>x</body></html>`;
    expect(extractDocument(html, "/x").boost).toBe(1.0);
  });

  it("ignores a non-positive searchable-boost and falls back to 1.0", () => {
    const html = `<html><head><title>Bad</title><meta name="searchable-boost" content="-3"></head><body>x</body></html>`;
    expect(extractDocument(html, "/x").boost).toBe(1.0);
  });

  it("has no facets, range facets, or pins by default", () => {
    const html = "<html><head><title>Plain</title></head><body>x</body></html>";
    const doc = extractDocument(html, "/x");
    expect(doc.facets).toEqual({});
    expect(doc.rangeFacets).toEqual({});
    expect(doc.pins).toEqual([]);
  });

  it("parses a searchable-facet-range-<field> tag as a single numeric value", () => {
    const html = `<html><head><title>Product</title>
      <meta name="searchable-facet-range-price" content="49.99">
      </head><body>x</body></html>`;
    const doc = extractDocument(html, "/x");
    expect(doc.rangeFacets).toEqual({ price: 49.99 });
    expect(doc.facets).toEqual({}); // not also parsed as a terms facet
  });

  it("ignores a non-numeric searchable-facet-range-<field> value", () => {
    const html = `<html><head><title>Product</title>
      <meta name="searchable-facet-range-price" content="call-for-quote">
      </head><body>x</body></html>`;
    const doc = extractDocument(html, "/x");
    expect(doc.rangeFacets).toEqual({});
  });

  it("keeps the first declared value when a range facet field is repeated", () => {
    const html = `<html><head><title>Product</title>
      <meta name="searchable-facet-range-price" content="10">
      <meta name="searchable-facet-range-price" content="20">
      </head><body>x</body></html>`;
    const doc = extractDocument(html, "/x");
    expect(doc.rangeFacets).toEqual({ price: 10 });
  });

  it("collects repeated searchable-facet-<field> tags into arrays, deduping repeats", () => {
    const html = `<html><head><title>Product</title>
      <meta name="searchable-facet-category" content="electronics">
      <meta name="searchable-facet-category" content="audio">
      <meta name="searchable-facet-category" content="audio">
      <meta name="searchable-facet-brand" content="acme">
      </head><body>x</body></html>`;
    const doc = extractDocument(html, "/x");
    expect(doc.facets).toEqual({
      category: ["electronics", "audio"],
      brand: ["acme"],
    });
  });

  it("collects repeated searchable-pin tags with page-level mode/priority/exclusive", () => {
    const html = `<html><head><title>Pricing</title>
      <meta name="searchable-pin" content="pricing">
      <meta name="searchable-pin" content="how much does it cost">
      <meta name="searchable-pin-mode" content="contains">
      <meta name="searchable-pin-priority" content="10">
      <meta name="searchable-pin-exclusive">
      </head><body>x</body></html>`;
    const doc = extractDocument(html, "/x");
    expect(doc.pins).toEqual([
      { phrase: "pricing", mode: "contains", priority: 10, exclusive: true },
      {
        phrase: "how much does it cost",
        mode: "contains",
        priority: 10,
        exclusive: true,
      },
    ]);
  });

  it("defaults pin mode to exact, priority to 0, and exclusive to false", () => {
    const html = `<html><head><title>Pricing</title>
      <meta name="searchable-pin" content="pricing"></head><body>x</body></html>`;
    const doc = extractDocument(html, "/x");
    expect(doc.pins).toEqual([
      { phrase: "pricing", mode: "exact", priority: 0, exclusive: false },
    ]);
  });

  it("falls back to exact for an unrecognized searchable-pin-mode value", () => {
    const html = `<html><head><title>Pricing</title>
      <meta name="searchable-pin" content="pricing">
      <meta name="searchable-pin-mode" content="bogus">
      </head><body>x</body></html>`;
    expect(extractDocument(html, "/x").pins[0]?.mode).toBe("exact");
  });

  it("auto-detects the language from title+body text when <html> declares no lang", () => {
    const germanHtml = `<html><head><title>Über uns</title></head>
      <body><main><p>Der schnelle braune Fuchs springt über den faulen Hund
      und das ist ein Test für den Detektor, nicht wahr?</p></main></body></html>`;
    expect(extractDocument(germanHtml, "/ueber-uns", "en").language).toBe("de");

    const englishHtml = `<html><head><title>About us</title></head>
      <body><main><p>The quick brown fox jumps over the lazy dog and this is
      a test of the detector for this page.</p></main></body></html>`;
    expect(extractDocument(englishHtml, "/about", "de").language).toBe("en");
  });

  it("prefers an explicit <html lang> over auto-detection even when the text suggests otherwise", () => {
    const html = `<html lang="fr"><head><title>Über uns</title></head>
      <body><main><p>Der schnelle braune Fuchs springt über den faulen Hund.</p></main></body></html>`;
    expect(extractDocument(html, "/x").language).toBe("fr");
  });

  it("preserves an explicit generic Norwegian compatibility code", () => {
    const html = `<html lang="no"><head><title>Norsk</title></head>
      <body><main><p>Ikke jeg hva også hvordan hvem.</p></main></body></html>`;
    expect(extractDocument(html, "/norsk").language).toBe("no");
  });

  it("falls back to defaultLanguage when detection has no confident signal, same as before auto-detection existed", () => {
    const html =
      "<html><head><title>Ohne Lang</title></head><body>x y z</body></html>";
    expect(extractDocument(html, "/x", "de").language).toBe("de");
  });
});

/**
 * Issue #1 finding 5 (productization review): a `<link rel="canonical">`
 * href flows straight through to `Hit.url`, which a consuming app may
 * render directly into a link -- untrusted/malformed rendered HTML
 * producing a `javascript:`/`data:`/protocol-relative URL would
 * otherwise be a real XSS footgun handed to every consumer.
 */
describe("extractDocument: canonical URL sanitization", () => {
  function withCanonical(href: string): string {
    return `<html><head><title>T</title><link rel="canonical" href="${href}"></head><body><main>x</main></body></html>`;
  }

  it("accepts an absolute http/https canonical URL", () => {
    expect(
      extractDocument(withCanonical("https://example.com/pricing"), "/x").url,
    ).toBe("https://example.com/pricing");
    expect(
      extractDocument(withCanonical("http://example.com/pricing"), "/x").url,
    ).toBe("http://example.com/pricing");
  });

  it("accepts a root-relative canonical path with no baseUrl needed", () => {
    expect(extractDocument(withCanonical("/products/widget"), "/x").url).toBe(
      "/products/widget",
    );
  });

  it("rejects a javascript: canonical URL, falling back to sourceUrl", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const doc = extractDocument(
      withCanonical("javascript:alert(1)"),
      "/safe-page",
    );
    expect(doc.url).toBe("/safe-page");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("disallowed protocol"),
    );
    warn.mockRestore();
  });

  it("rejects a data: canonical URL, falling back to sourceUrl", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const doc = extractDocument(
      withCanonical("data:text/html,<script>alert(1)</script>"),
      "/safe-page",
    );
    expect(doc.url).toBe("/safe-page");
    warn.mockRestore();
  });

  it("rejects a protocol-relative canonical URL with no baseUrl configured", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const doc = extractDocument(
      withCanonical("//evil.example.com/phish"),
      "/safe-page",
    );
    expect(doc.url).toBe("/safe-page");
    warn.mockRestore();
  });

  it("rejects a malformed canonical URL, falling back to sourceUrl", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const doc = extractDocument(withCanonical("not a url::"), "/safe-page");
    expect(doc.url).toBe("/safe-page");
    warn.mockRestore();
  });

  it("allowedUrlOrigins accepts a listed origin", () => {
    const doc = extractDocument(
      withCanonical("https://example.com/pricing"),
      "/x",
      "en",
      { allowedUrlOrigins: ["https://example.com"] },
    );
    expect(doc.url).toBe("https://example.com/pricing");
  });

  it("allowedUrlOrigins rejects an unlisted origin, falling back to sourceUrl", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const doc = extractDocument(
      withCanonical("https://evil.example.com/pricing"),
      "/safe-page",
      "en",
      { allowedUrlOrigins: ["https://example.com"] },
    );
    expect(doc.url).toBe("/safe-page");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("not in allowedUrlOrigins"),
    );
    warn.mockRestore();
  });

  it("baseUrl resolves a protocol-relative canonical URL before origin checks run", () => {
    const doc = extractDocument(
      withCanonical("//example.com/pricing"),
      "/x",
      "en",
      { baseUrl: "https://example.com" },
    );
    expect(doc.url).toBe("https://example.com/pricing");
  });

  it("no canonical tag at all still falls back to sourceUrl, unaffected", () => {
    const html =
      "<html><head><title>T</title></head><body><main>x</main></body></html>";
    expect(extractDocument(html, "/plain-page").url).toBe("/plain-page");
  });
});
