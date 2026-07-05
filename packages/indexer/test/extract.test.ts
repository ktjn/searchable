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
});
