import { describe, expect, it } from "vitest";
import { generateCms2kCorpus, MARKETING_PAGES } from "../src/index.js";

describe("generateCms2kCorpus", () => {
  it("is deterministic: the same options produce byte-identical output", () => {
    const a = generateCms2kCorpus({ count: 50 });
    const b = generateCms2kCorpus({ count: 50 });
    expect(a).toEqual(b);
  });

  it("defaults to English + German only (no Japanese/Arabic, which have no LanguageProfile yet)", () => {
    const docs = generateCms2kCorpus({ count: 20 });
    const languages = new Set(
      docs.map((d) => /<html lang="([a-z]+)"/.exec(d.html)?.[1]),
    );
    expect(languages).toEqual(new Set(["en", "de"]));
  });

  it("generates roughly `count` documents plus the fixed marketing pages, per requested language", () => {
    const docs = generateCms2kCorpus({ count: 100, languages: ["en"] });
    // marketing pages + ~100 generated, all English since only "en" was requested
    expect(docs.length).toBeGreaterThanOrEqual(100 + MARKETING_PAGES.length);
    expect(docs.length).toBeLessThan(100 + MARKETING_PAGES.length + 5);
    for (const doc of docs) {
      expect(doc.html).toContain('<html lang="en">');
    }
  });

  it("every document has a unique id and a unique url", () => {
    const docs = generateCms2kCorpus({ count: 300 });
    expect(new Set(docs.map((d) => d.id)).size).toBe(docs.length);
    expect(new Set(docs.map((d) => d.url)).size).toBe(docs.length);
  });

  it("every generated (non-marketing) document has a title, a category facet, and at least one tag", () => {
    const docs = generateCms2kCorpus({ count: 40, languages: ["en"] });
    const generated = docs.slice(MARKETING_PAGES.length);
    for (const doc of generated) {
      expect(doc.html).toMatch(/<title>.+<\/title>/);
      expect(doc.html).toContain('name="csf-facet-category"');
      expect(doc.html).toContain('name="csf-facet-tags"');
    }
  });

  it("marks roughly 1 in 20 generated documents as featured (csf-boost)", () => {
    const docs = generateCms2kCorpus({ count: 200, languages: ["en"] });
    const generated = docs.slice(MARKETING_PAGES.length);
    const featured = generated.filter((d) => d.html.includes("csf-boost"));
    expect(featured.length).toBeGreaterThan(5);
    expect(featured.length).toBeLessThan(generated.length / 5);
  });

  it("includes the fixed marketing pages with authored pins, once per requested language", () => {
    const docs = generateCms2kCorpus({ count: 10 });
    const pricingPages = docs.filter((d) => d.url.endsWith("/pricing.html"));
    expect(pricingPages).toHaveLength(2); // one per language (en, de)

    const enPricing = pricingPages.find((d) => d.url.startsWith("/en/"));
    expect(enPricing?.html).toContain('name="csf-pin" content="pricing"');
    const dePricing = pricingPages.find((d) => d.url.startsWith("/de/"));
    expect(dePricing?.html).toContain('name="csf-pin" content="preise"');

    const contactPages = docs.filter((d) => d.url.endsWith("/contact.html"));
    expect(contactPages).toHaveLength(2);
  });
});
