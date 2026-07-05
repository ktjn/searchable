import { describe, expect, it } from "vitest";
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

  it("respects csf-noindex", () => {
    const html = `<html><head><title>Draft</title><meta name="csf-noindex"></head><body>x</body></html>`;
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

  it("respects data-csf-body as an explicit content boundary", () => {
    const html = `
      <html><body>
        <main>ignored default region</main>
        <div data-csf-body>the real content</div>
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

  it("defaults boost to 1.0 when csf-boost is absent", () => {
    const html =
      "<html><head><title>Normal</title></head><body>x</body></html>";
    expect(extractDocument(html, "/x").boost).toBe(1.0);
  });

  it("parses csf-boost", () => {
    const html = `<html><head><title>Featured</title><meta name="csf-boost" content="2.5"></head><body>x</body></html>`;
    expect(extractDocument(html, "/x").boost).toBe(2.5);
  });

  it("ignores a malformed csf-boost and falls back to 1.0", () => {
    const html = `<html><head><title>Bad</title><meta name="csf-boost" content="not-a-number"></head><body>x</body></html>`;
    expect(extractDocument(html, "/x").boost).toBe(1.0);
  });

  it("ignores a non-positive csf-boost and falls back to 1.0", () => {
    const html = `<html><head><title>Bad</title><meta name="csf-boost" content="-3"></head><body>x</body></html>`;
    expect(extractDocument(html, "/x").boost).toBe(1.0);
  });

  it("has no facets, range facets, or pins by default", () => {
    const html = "<html><head><title>Plain</title></head><body>x</body></html>";
    const doc = extractDocument(html, "/x");
    expect(doc.facets).toEqual({});
    expect(doc.rangeFacets).toEqual({});
    expect(doc.pins).toEqual([]);
  });

  it("parses a csf-facet-range-<field> tag as a single numeric value", () => {
    const html = `<html><head><title>Product</title>
      <meta name="csf-facet-range-price" content="49.99">
      </head><body>x</body></html>`;
    const doc = extractDocument(html, "/x");
    expect(doc.rangeFacets).toEqual({ price: 49.99 });
    expect(doc.facets).toEqual({}); // not also parsed as a terms facet
  });

  it("ignores a non-numeric csf-facet-range-<field> value", () => {
    const html = `<html><head><title>Product</title>
      <meta name="csf-facet-range-price" content="call-for-quote">
      </head><body>x</body></html>`;
    const doc = extractDocument(html, "/x");
    expect(doc.rangeFacets).toEqual({});
  });

  it("keeps the first declared value when a range facet field is repeated", () => {
    const html = `<html><head><title>Product</title>
      <meta name="csf-facet-range-price" content="10">
      <meta name="csf-facet-range-price" content="20">
      </head><body>x</body></html>`;
    const doc = extractDocument(html, "/x");
    expect(doc.rangeFacets).toEqual({ price: 10 });
  });

  it("collects repeated csf-facet-<field> tags into arrays, deduping repeats", () => {
    const html = `<html><head><title>Product</title>
      <meta name="csf-facet-category" content="electronics">
      <meta name="csf-facet-category" content="audio">
      <meta name="csf-facet-category" content="audio">
      <meta name="csf-facet-brand" content="acme">
      </head><body>x</body></html>`;
    const doc = extractDocument(html, "/x");
    expect(doc.facets).toEqual({
      category: ["electronics", "audio"],
      brand: ["acme"],
    });
  });

  it("collects repeated csf-pin tags with page-level mode/priority/exclusive", () => {
    const html = `<html><head><title>Pricing</title>
      <meta name="csf-pin" content="pricing">
      <meta name="csf-pin" content="how much does it cost">
      <meta name="csf-pin-mode" content="contains">
      <meta name="csf-pin-priority" content="10">
      <meta name="csf-pin-exclusive">
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
      <meta name="csf-pin" content="pricing"></head><body>x</body></html>`;
    const doc = extractDocument(html, "/x");
    expect(doc.pins).toEqual([
      { phrase: "pricing", mode: "exact", priority: 0, exclusive: false },
    ]);
  });

  it("falls back to exact for an unrecognized csf-pin-mode value", () => {
    const html = `<html><head><title>Pricing</title>
      <meta name="csf-pin" content="pricing">
      <meta name="csf-pin-mode" content="bogus">
      </head><body>x</body></html>`;
    expect(extractDocument(html, "/x").pins[0]?.mode).toBe("exact");
  });
});
