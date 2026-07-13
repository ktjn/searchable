import { generateCms2kCorpus } from "@csf/fixtures";
import { describe, expect, it } from "vitest";
import { buildIndex } from "../src/build-index.js";
import type { SourceDocument } from "../src/types.js";

/**
 * Exercises the real indexer against a realistically-shaped,
 * moderate-scale corpus (docs/guides/indexing.md,
 * docs/project/roadmap.md#status Phase 0) rather than the handful of
 * one-off sentences used elsewhere in this file -- catches the class
 * of bug that only shows up with real prose and real volume (e.g. a
 * facet/tag/pin distribution that "happens to work" on three fixture
 * docs but not on hundreds of realistically varied ones).
 */
describe("buildIndex against the CMS-2k reference fixture", () => {
  it("indexes every document across both languages without error or warning", () => {
    const sources = generateCms2kCorpus({ count: 500 });
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: string) => warnings.push(msg);
    try {
      const built = buildIndex(sources);
      const totalIndexed = Object.values(built.manifest.docCount).reduce(
        (sum, n) => sum + n,
        0,
      );
      expect(totalIndexed).toBe(sources.length);
      expect(warnings).toEqual([]);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("partitions documents by language, one term shard per language actually present", () => {
    const sources = generateCms2kCorpus({ count: 400 });
    const built = buildIndex(sources);

    expect(Object.keys(built.termShards).sort()).toEqual(["de", "en"]);
    expect(built.manifest.languages.sort()).toEqual(["de", "en"]);
    // roughly balanced -- generateCms2kCorpus splits requested count evenly
    const enCount = built.manifest.docCount.en ?? 0;
    const deCount = built.manifest.docCount.de ?? 0;
    expect(Math.abs(enCount - deCount)).toBeLessThan(10);
  });

  it("collects every generated facet field (category, tags) at this scale", () => {
    const sources = generateCms2kCorpus({ count: 300, languages: ["en"] });
    const built = buildIndex(sources);

    const facetFields = Object.keys(built.facetShards).sort();
    expect(facetFields).toEqual(["category", "tags"]);

    const categories = Object.keys(
      built.facetShards.category?.values ?? {},
    ).sort();
    expect(categories).toEqual(["Company", "Engineering", "Guides", "Product"]);
  });

  it("resolves the fixed marketing-page pins ('pricing', 'contact') even amid hundreds of generated pages", () => {
    const sources = generateCms2kCorpus({ count: 400, languages: ["en"] });
    const built = buildIndex(sources);

    // "pricing" stems to "price" (docs/guides/internationalization.md#stemming); "contact" is unaffected.
    const pinsShard = built.pinsShards.en ?? {};
    expect(pinsShard.price?.docs.length).toBeGreaterThan(0);
    expect(pinsShard.contact?.docs.length).toBeGreaterThan(0);
  });

  it("marks a small, non-zero minority of documents as boosted (csf-boost), not all or none", () => {
    const sources = generateCms2kCorpus({ count: 400, languages: ["en"] });
    const built = buildIndex(sources);

    const boostedIds = new Set(
      Object.entries(built.docStore)
        .filter(([, entry]) => entry.boost !== undefined)
        .map(([id]) => id),
    );
    expect(boostedIds.size).toBeGreaterThan(0);
    expect(boostedIds.size).toBeLessThan(sources.length / 5);
  });

  it("build time scales roughly linearly with corpus size, not quadratically, for a corpus with high posting-list density", () => {
    // Regression guard for a real O(n^2) bug found while establishing a
    // JSON-tier scaling baseline for the Phase 7 investigation
    // (docs/concepts/binary-storage.md): addPostings() used to look up
    // a term's existing posting for a doc via `entry.postings.find()`,
    // an O(df) scan repeated for every (term, doc) pair, making the
    // whole build O(n^2) in corpus size once a term's posting list grew
    // large. A hand-rolled worst-case corpus (every doc shares the same
    // small vocabulary, maximizing every term's document frequency) is
    // used rather than the naturalistic CMS-2k generator, since a more
    // realistic vocabulary spread dilutes any single term's df enough
    // that the quadratic cost doesn't show up until a much larger (and
    // much slower to test) corpus size. Measured on this exact corpus
    // shape before the fix: 2000 docs ~0.7s, 16000 docs ~15.8s (~22x for
    // an 8x corpus-size jump); after the fix: ~0.6s and ~3.5s (~6x).
    function denseCorpus(count: number): SourceDocument[] {
      const html =
        '<html lang="en"><head><title>widget gadget doohickey thingamajig</title></head>' +
        "<body><main><p>widget gadget doohickey thingamajig common shared words " +
        "repeated across every single document in this corpus to maximize " +
        "posting list density</p></main></body></html>";
      return Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        url: `/${i + 1}`,
        html,
      }));
    }

    const small = denseCorpus(2000);
    const large = denseCorpus(16000);

    const t0 = performance.now();
    buildIndex(small);
    const smallMs = performance.now() - t0;

    const t1 = performance.now();
    buildIndex(large);
    const largeMs = performance.now() - t1;

    // True linear scaling lands near 8x; the fixed quadratic bug
    // measured ~22x for this same 8x corpus-size jump. 12x sits
    // between the two with margin on both sides.
    expect(largeMs).toBeLessThan(smallMs * 12);
  });
});
