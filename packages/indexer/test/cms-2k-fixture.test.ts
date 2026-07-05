import { generateCms2kCorpus } from "@csf/fixtures";
import { describe, expect, it } from "vitest";
import { buildIndex } from "../src/build-index.js";

/**
 * Exercises the real indexer against a realistically-shaped,
 * moderate-scale corpus (docs/14-reference-deployment-cms-2k.md,
 * docs/09-roadmap.md#status Phase 0) rather than the handful of
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

    const pinsShard = built.pinsShards.en ?? {};
    expect(pinsShard.pricing?.docs.length).toBeGreaterThan(0);
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
});
