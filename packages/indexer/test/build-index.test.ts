import { describe, expect, it, vi } from "vitest";
import { buildIndex } from "../src/build-index.js";
import type { SourceDocument } from "../src/types.js";

const sources: SourceDocument[] = [
  {
    id: 1,
    url: "/widgets",
    html: `<html lang="en"><head><title>Widgets</title></head>
      <body><main><p>We sell wonderful widgets for everyone.</p></main></body></html>`,
  },
  {
    id: 2,
    url: "/gadgets",
    html: `<html lang="en"><head><title>Gadgets</title></head>
      <body><main><p>Gadgets and gizmos, but no widgets here.</p></main></body></html>`,
  },
  {
    id: 3,
    url: "/draft",
    html: `<html lang="en"><head><title>Draft</title><meta name="csf-noindex"></head>
      <body><main><p>widgets widgets widgets</p></main></body></html>`,
  },
  {
    id: 4,
    url: "/featured-widgets",
    html: `<html lang="en"><head><title>Featured Widgets</title><meta name="csf-boost" content="2.0"></head>
      <body><main><p>widgets on sale</p></main></body></html>`,
  },
];

describe("buildIndex", () => {
  it("indexes documents and produces correct postings", () => {
    const built = buildIndex(sources);
    expect(built.manifest.docCount.en).toBe(3); // draft excluded
    expect(built.termShards.en?.widgets?.df).toBe(3);
    expect(
      built.termShards.en?.widgets?.postings.map((p) => p.doc).sort(),
    ).toEqual([1, 2, 4]);
    expect(built.termShards.en?.gizmos?.df).toBe(1);
    expect(built.termShards.en?.gizmos?.postings[0]?.doc).toBe(2);
  });

  it("sets posting-level boost from csf-boost, omitting it when default", () => {
    const built = buildIndex(sources);
    const boosted = built.termShards.en?.widgets?.postings.find(
      (p) => p.doc === 4,
    );
    const unboosted = built.termShards.en?.widgets?.postings.find(
      (p) => p.doc === 1,
    );
    expect(boosted?.boost).toBe(2.0);
    expect(unboosted?.boost).toBeUndefined();
  });

  it("mirrors the boost onto the doc store for display/audit purposes", () => {
    const built = buildIndex(sources);
    expect(built.docStore["4"]?.boost).toBe(2.0);
    expect(built.docStore["1"]?.boost).toBeUndefined();
  });

  it("defaults field boosts to title=3.0, body=1.0", () => {
    const built = buildIndex(sources);
    expect(built.manifest.fields.title?.boost).toBe(3.0);
    expect(built.manifest.fields.body?.boost).toBe(1.0);
  });

  it("lets field boosts be overridden at build time", () => {
    const built = buildIndex(sources, "en", { fieldBoosts: { title: 5 } });
    expect(built.manifest.fields.title?.boost).toBe(5);
    expect(built.manifest.fields.body?.boost).toBe(1.0); // unspecified stays default
  });

  it("excludes csf-noindex documents entirely", () => {
    const built = buildIndex(sources);
    expect(built.docStore["3"]).toBeUndefined();
    expect(built.termShards.en?.draft).toBeUndefined();
  });

  it("records per-field term frequency and positions", () => {
    const built = buildIndex(sources);
    const posting = built.termShards.en?.widgets?.postings.find(
      (p) => p.doc === 1,
    );
    // doc 1's title is literally "Widgets", so it appears in both fields
    expect(posting?.fields.title).toEqual({ tf: 1, pos: [0], len: 1 });
    expect(posting?.fields.body).toEqual({ tf: 1, pos: [3], len: 6 });
  });

  it("computes avgFieldLength across indexed (non-noindex) docs only", () => {
    const built = buildIndex(sources);
    // titles: "Widgets"=1, "Gadgets"=1, "Featured Widgets"=2 tokens -> 4/3
    expect(built.manifest.avgFieldLength.en?.title).toBeCloseTo(4 / 3);
  });

  it("stores title and a derived excerpt in the doc store", () => {
    const built = buildIndex(sources);
    expect(built.docStore["1"]?.url).toBe("/widgets");
    expect(built.docStore["1"]?.fields.title).toBe("Widgets");
    expect(built.docStore["1"]?.fields.excerpt).toContain("wonderful widgets");
  });
});

describe("buildIndex facets", () => {
  const facetSources: SourceDocument[] = [
    {
      id: 1,
      url: "/a",
      html: `<html lang="en"><head><title>A</title>
        <meta name="csf-facet-category" content="electronics">
        <meta name="csf-facet-brand" content="acme"></head>
        <body><main>a</main></body></html>`,
    },
    {
      id: 2,
      url: "/b",
      html: `<html lang="en"><head><title>B</title>
        <meta name="csf-facet-category" content="electronics">
        <meta name="csf-facet-brand" content="globex"></head>
        <body><main>b</main></body></html>`,
    },
    {
      id: 3,
      url: "/c",
      html: `<html lang="en"><head><title>C</title>
        <meta name="csf-facet-category" content="books"></head>
        <body><main>c</main></body></html>`,
    },
  ];

  it("aggregates facet values per field across documents", () => {
    const built = buildIndex(facetSources);
    expect(built.facetShards.category?.values.electronics).toEqual({
      count: 2,
      docs: [1, 2],
    });
    expect(built.facetShards.category?.values.books).toEqual({
      count: 1,
      docs: [3],
    });
    expect(built.facetShards.brand?.values.acme).toEqual({
      count: 1,
      docs: [1],
    });
  });

  it("tags every facet shard as type: terms", () => {
    const built = buildIndex(facetSources);
    expect(built.facetShards.category?.type).toBe("terms");
  });

  it("lists every facet field found, sorted, on the manifest", () => {
    const built = buildIndex(facetSources);
    expect(built.manifest.facetFields).toEqual(["brand", "category"]);
  });

  it("omits facetFields entirely when no document declares a facet", () => {
    const built = buildIndex(sources);
    expect(built.manifest.facetFields).toBeUndefined();
    expect(built.facetShards).toEqual({});
  });
});

describe("buildIndex pins", () => {
  it("keys the pins shard by the normalized (analyzed) phrase", () => {
    const built = buildIndex([
      {
        id: 1,
        url: "/pricing",
        html: `<html lang="en"><head><title>Pricing</title>
          <meta name="csf-pin" content="Pricing Plans"></head>
          <body><main>x</main></body></html>`,
      },
    ]);
    // Normalized the same way any other indexed term is (lowercased via
    // the English profile) — the English profile has no stemmer yet, so
    // this is just case-folding for now, but the same analyze() call
    // any future stemmer would run through.
    expect(built.pinsShards.en?.["pricing plans"]).toEqual({
      mode: "exact",
      docs: [{ id: 1, priority: 0, exclusive: false }],
    });
  });

  it("carries mode/priority/exclusive through from the page's csf-pin* tags", () => {
    const built = buildIndex([
      {
        id: 1,
        url: "/pricing",
        html: `<html lang="en"><head><title>Pricing</title>
          <meta name="csf-pin" content="cost">
          <meta name="csf-pin-mode" content="contains">
          <meta name="csf-pin-priority" content="10">
          <meta name="csf-pin-exclusive"></head>
          <body><main>x</main></body></html>`,
      },
    ]);
    expect(built.pinsShards.en?.cost).toEqual({
      mode: "contains",
      docs: [{ id: 1, priority: 10, exclusive: true }],
    });
  });

  it("omits pin docs from a noindex page", () => {
    const built = buildIndex([
      {
        id: 1,
        url: "/draft",
        html: `<html lang="en"><head><title>Draft</title>
          <meta name="csf-noindex">
          <meta name="csf-pin" content="draft"></head>
          <body><main>x</main></body></html>`,
      },
    ]);
    expect(built.pinsShards).toEqual({});
  });

  it("resolves a pin conflict by priority, then boost, then build order, and warns", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const built = buildIndex([
      {
        id: 1,
        url: "/low-priority",
        html: `<html lang="en"><head><title>Low</title>
          <meta name="csf-pin" content="pricing"></head>
          <body><main>x</main></body></html>`,
      },
      {
        id: 2,
        url: "/high-priority",
        html: `<html lang="en"><head><title>High</title>
          <meta name="csf-pin" content="pricing">
          <meta name="csf-pin-priority" content="5"></head>
          <body><main>x</main></body></html>`,
      },
      {
        id: 3,
        url: "/tied-but-boosted",
        html: `<html lang="en"><head><title>Boosted</title>
          <meta name="csf-pin" content="pricing">
          <meta name="csf-boost" content="2.0"></head>
          <body><main>x</main></body></html>`,
      },
    ]);
    expect(built.pinsShards.en?.pricing?.docs.map((d) => d.id)).toEqual([
      2, 3, 1,
    ]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('pin conflict: "pricing"'),
    );
    warnSpy.mockRestore();
  });

  it("does not warn when only one page pins a given phrase", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    buildIndex([
      {
        id: 1,
        url: "/pricing",
        html: `<html lang="en"><head><title>Pricing</title>
          <meta name="csf-pin" content="pricing"></head>
          <body><main>x</main></body></html>`,
      },
    ]);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("buildIndex multi-language corpora", () => {
  const mixedSources: SourceDocument[] = [
    {
      id: 1,
      url: "/en/widgets",
      html: `<html lang="en"><head><title>Widgets</title></head>
        <body><main><p>We sell wonderful widgets.</p></main></body></html>`,
    },
    {
      id: 2,
      url: "/de/preise",
      html: `<html lang="de"><head><title>Preise</title></head>
        <body><main><p>Unsere Preise sind einfach und fair.</p></main></body></html>`,
    },
    {
      id: 3,
      url: "/de/kontakt",
      html: `<html lang="de"><head><title>Kontakt</title>
        <meta name="csf-pin" content="kontakt"></head>
        <body><main><p>So erreichen Sie uns.</p></main></body></html>`,
    },
    {
      id: 4,
      url: "/no-lang",
      html: `<html><head><title>Untitled</title></head>
        <body><main><p>falls back to the corpus default language</p></main></body></html>`,
    },
  ];

  it("lists every language actually present in the corpus, sorted", () => {
    const built = buildIndex(mixedSources);
    expect(built.manifest.languages).toEqual(["de", "en"]);
  });

  it("partitions each document into its own language's term shard", () => {
    const built = buildIndex(mixedSources);
    expect(built.termShards.en?.widgets).toBeDefined();
    expect(built.termShards.de?.widgets).toBeUndefined();
    expect(built.termShards.de?.preise).toBeDefined();
    expect(built.termShards.en?.preise).toBeUndefined();
  });

  it("falls back a document without <html lang> to the corpus's default language", () => {
    const built = buildIndex(mixedSources, "en");
    expect(built.termShards.en?.untitled?.postings.map((p) => p.doc)).toEqual([
      4,
    ]);
    expect(built.termShards.de?.untitled).toBeUndefined();
  });

  it("computes docCount and avgFieldLength independently per language", () => {
    const built = buildIndex(mixedSources);
    expect(built.manifest.docCount).toEqual({ en: 2, de: 2 });
    // en titles: "Widgets"=1, "Untitled"=1 -> avg 1; de titles: "Preise"=1, "Kontakt"=1 -> avg 1
    expect(built.manifest.avgFieldLength.en?.title).toBeCloseTo(1);
    expect(built.manifest.avgFieldLength.de?.title).toBeCloseTo(1);
  });

  it("keeps facet shards corpus-wide, not partitioned by language", () => {
    const built = buildIndex([
      {
        id: 1,
        url: "/en/a",
        html: `<html lang="en"><head><title>A</title>
          <meta name="csf-facet-category" content="shared"></head>
          <body><main>a</main></body></html>`,
      },
      {
        id: 2,
        url: "/de/b",
        html: `<html lang="de"><head><title>B</title>
          <meta name="csf-facet-category" content="shared"></head>
          <body><main>b</main></body></html>`,
      },
    ]);
    expect(built.facetShards.category?.values.shared).toEqual({
      count: 2,
      docs: [1, 2],
    });
  });

  it("partitions pins by language, keyed under each document's own language", () => {
    const built = buildIndex(mixedSources);
    expect(built.pinsShards.de?.kontakt?.docs.map((d) => d.id)).toEqual([3]);
    expect(built.pinsShards.en).toBeUndefined();
  });
});

describe("buildIndex source id validation", () => {
  const page = (id: number, url: string): SourceDocument => ({
    id,
    url,
    html: `<html lang="en"><head><title>Page</title></head><body><main>x</main></body></html>`,
  });

  it("rejects duplicate document ids", () => {
    expect(() => buildIndex([page(1, "/a"), page(1, "/b")])).toThrow(
      /duplicate document id 1/,
    );
  });

  it("rejects a non-integer document id", () => {
    expect(() => buildIndex([page(1.5, "/a")])).toThrow(/invalid document id/);
  });

  it("rejects a negative document id", () => {
    expect(() => buildIndex([page(-1, "/a")])).toThrow(/invalid document id/);
  });

  it("accepts distinct non-negative integer ids, including zero", () => {
    expect(() =>
      buildIndex([page(0, "/a"), page(1, "/b"), page(2, "/c")]),
    ).not.toThrow();
  });

  it("catches a duplicate even when one of the pair is csf-noindex", () => {
    const noindexPage: SourceDocument = {
      id: 1,
      url: "/draft",
      html: `<html lang="en"><head><title>Draft</title><meta name="csf-noindex"></head><body><main>x</main></body></html>`,
    };
    expect(() => buildIndex([page(1, "/a"), noindexPage])).toThrow(
      /duplicate document id 1/,
    );
  });
});

describe("buildIndex synonyms", () => {
  const minimalSources: SourceDocument[] = [
    {
      id: 1,
      url: "/a",
      html: `<html lang="en"><head><title>A</title></head><body><main>x</main></body></html>`,
    },
  ];

  it("normalizes equivalence-class entries through the language's analysis pipeline", () => {
    const built = buildIndex(minimalSources, "en", {
      synonyms: { en: { equivalences: [["Sofa", "Couch", "Settee"]] } },
    });
    expect(built.synonymShards.en?.equivalences).toEqual([
      ["sofa", "couch", "settee"],
    ]);
  });

  it("normalizes directional keys and targets", () => {
    const built = buildIndex(minimalSources, "en", {
      synonyms: { en: { directional: { Laptop: ["Notebook"] } } },
    });
    expect(built.synonymShards.en?.directional).toEqual({
      laptop: ["notebook"],
    });
  });

  it("drops an equivalence group left with fewer than two distinct members after normalizing", () => {
    // Both entries analyze to the same term, so nothing is left to expand to.
    const built = buildIndex(minimalSources, "en", {
      synonyms: { en: { equivalences: [["Sofa", "SOFA"]] } },
    });
    expect(built.synonymShards.en?.equivalences).toBeUndefined();
  });

  it("omits equivalences/directional keys entirely when empty rather than emitting empty containers", () => {
    const built = buildIndex(minimalSources, "en", {
      synonyms: { en: {} },
    });
    expect(built.synonymShards.en).toEqual({});
  });

  it("returns no synonym shards at all when no synonyms option is given", () => {
    const built = buildIndex(minimalSources);
    expect(built.synonymShards).toEqual({});
  });

  it("keeps synonym data separate per language", () => {
    const built = buildIndex(minimalSources, "en", {
      synonyms: {
        en: { equivalences: [["sofa", "couch"]] },
        de: { equivalences: [["Sofa", "Couch"]] },
      },
    });
    expect(built.synonymShards.en?.equivalences).toEqual([["sofa", "couch"]]);
    expect(built.synonymShards.de?.equivalences).toEqual([["sofa", "couch"]]);
  });
});
