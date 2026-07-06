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
    // "widgets" stems to "widget" (docs/03-tokenization-i18n.md#stemming).
    expect(built.termShards.en?.widget?.df).toBe(3);
    expect(
      built.termShards.en?.widget?.postings.map((p) => p.doc).sort(),
    ).toEqual([1, 2, 4]);
    expect(built.termShards.en?.gizmo?.df).toBe(1);
    expect(built.termShards.en?.gizmo?.postings[0]?.doc).toBe(2);
  });

  it("sets posting-level boost from csf-boost, omitting it when default", () => {
    const built = buildIndex(sources);
    const boosted = built.termShards.en?.widget?.postings.find(
      (p) => p.doc === 4,
    );
    const unboosted = built.termShards.en?.widget?.postings.find(
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
    const posting = built.termShards.en?.widget?.postings.find(
      (p) => p.doc === 1,
    );
    // doc 1's title is literally "Widgets" (stemmed to "widget"), so it appears in both fields
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

describe("buildIndex range facets", () => {
  const rangeSources: SourceDocument[] = [
    {
      id: 1,
      url: "/a",
      html: `<html lang="en"><head><title>A</title>
        <meta name="csf-facet-range-price" content="29.99"></head>
        <body><main>a</main></body></html>`,
    },
    {
      id: 2,
      url: "/b",
      html: `<html lang="en"><head><title>B</title>
        <meta name="csf-facet-range-price" content="9.5"></head>
        <body><main>b</main></body></html>`,
    },
    {
      id: 3,
      url: "/c",
      html: `<html lang="en"><head><title>C</title>
        <meta name="csf-facet-range-price" content="150"></head>
        <body><main>c</main></body></html>`,
    },
  ];

  it("tags the shard as type: range and computes aggregate bucket values from the observed [min, max]", () => {
    const built = buildIndex(rangeSources);
    expect(built.facetShards.price?.type).toBe("range");
    // min=9.5, max=150 -> 5 equal-width buckets of width 28.1 each;
    // 9.5 and 29.99 both fall in the first ("9.5-37.6"), 150 falls in
    // the last, open-ended bucket ("121.9+").
    expect(built.facetShards.price?.values).toEqual({
      "9.5-37.6": { count: 2, docs: [1, 2] },
      "121.9+": { count: 1, docs: [3] },
    });
  });

  it("stores every (value, doc) pair sorted ascending by value, independent of processing order", () => {
    const built = buildIndex([...rangeSources].reverse());
    expect(built.facetShards.price?.sorted).toEqual([
      { value: 9.5, doc: 2 },
      { value: 29.99, doc: 1 },
      { value: 150, doc: 3 },
    ]);
  });

  it("lists a range facet field on the manifest same as a terms facet field", () => {
    const built = buildIndex(rangeSources);
    expect(built.manifest.facetFields).toEqual(["price"]);
  });

  it("ignores a non-numeric range facet value", () => {
    const built = buildIndex([
      {
        id: 1,
        url: "/a",
        html: `<html lang="en"><head><title>A</title>
          <meta name="csf-facet-range-price" content="not-a-number"></head>
          <body><main>a</main></body></html>`,
      },
    ]);
    expect(built.facetShards.price).toBeUndefined();
  });

  it("keeps a plain csf-facet-<field> tag from being misparsed as a range field literally named 'range-<field>'", () => {
    const built = buildIndex([
      {
        id: 1,
        url: "/a",
        html: `<html lang="en"><head><title>A</title>
          <meta name="csf-facet-category" content="electronics"></head>
          <body><main>a</main></body></html>`,
      },
    ]);
    expect(Object.keys(built.facetShards)).toEqual(["category"]);
    expect(built.facetShards["range-category"]).toBeUndefined();
  });

  it("first declaration wins when a field is authored as both a terms and a range facet somewhere in the corpus", () => {
    const built = buildIndex([
      {
        id: 1,
        url: "/a",
        html: `<html lang="en"><head><title>A</title>
          <meta name="csf-facet-price" content="on-sale"></head>
          <body><main>a</main></body></html>`,
      },
      {
        id: 2,
        url: "/b",
        html: `<html lang="en"><head><title>B</title>
          <meta name="csf-facet-range-price" content="42"></head>
          <body><main>b</main></body></html>`,
      },
    ]);
    expect(built.facetShards.price?.type).toBe("terms");
  });

  it("computes a single bucket labeled with the value itself when every doc shares the same range value", () => {
    const built = buildIndex([
      {
        id: 1,
        url: "/a",
        html: `<html lang="en"><head><title>A</title>
          <meta name="csf-facet-range-price" content="42"></head>
          <body><main>a</main></body></html>`,
      },
      {
        id: 2,
        url: "/b",
        html: `<html lang="en"><head><title>B</title>
          <meta name="csf-facet-range-price" content="42"></head>
          <body><main>b</main></body></html>`,
      },
    ]);
    // A zero-width [min, max] would otherwise produce 5 degenerate,
    // identically-labeled buckets -- one real bucket is correct instead.
    expect(built.facetShards.price?.values).toEqual({
      "42": { count: 2, docs: [1, 2] },
    });
  });

  it("distributes values across all 5 equal-width buckets, sorting each bucket's docs ascending independent of feed order", () => {
    const evenlySpread: SourceDocument[] = [0, 25, 50, 75, 100].map(
      (value, i) => ({
        id: i + 1,
        url: `/${i}`,
        html: `<html lang="en"><head><title>Doc ${i}</title>
          <meta name="csf-facet-range-score" content="${value}"></head>
          <body><main>x</main></body></html>`,
      }),
    );
    const built = buildIndex([...evenlySpread].reverse());
    expect(built.facetShards.score?.values).toEqual({
      "0-20": { count: 1, docs: [1] },
      "20-40": { count: 1, docs: [2] },
      "40-60": { count: 1, docs: [3] },
      "60-80": { count: 1, docs: [4] },
      "80+": { count: 1, docs: [5] },
    });
  });

  it("honors a per-field rangeFacetBuckets override instead of the default 5", () => {
    const evenlySpread: SourceDocument[] = [0, 25, 50, 75, 100].map(
      (value, i) => ({
        id: i + 1,
        url: `/${i}`,
        html: `<html lang="en"><head><title>Doc ${i}</title>
          <meta name="csf-facet-range-score" content="${value}"></head>
          <body><main>x</main></body></html>`,
      }),
    );
    const built = buildIndex(evenlySpread, "en", {
      rangeFacetBuckets: { score: 2 },
    });
    expect(built.facetShards.score?.values).toEqual({
      "0-50": { count: 2, docs: [1, 2] },
      "50+": { count: 3, docs: [3, 4, 5] },
    });
  });

  it("defaults an unconfigured range field to 5 buckets even when a different field is overridden", () => {
    // Five evenly-spread values per field so every one of the default
    // 5 buckets actually gets a doc (an empty bucket never gets a
    // shard.values entry at all -- see the "single distinct value"
    // test above -- so a sparser fixture couldn't distinguish "5
    // buckets" from "however many happened to be populated").
    const built = buildIndex(
      [0, 25, 50, 75, 100].map((value, i) => ({
        id: i + 1,
        url: `/${i}`,
        html: `<html lang="en"><head><title>Doc ${i}</title>
          <meta name="csf-facet-range-price" content="${value}">
          <meta name="csf-facet-range-score" content="${value}"></head>
          <body><main>x</main></body></html>`,
      })),
      "en",
      { rangeFacetBuckets: { price: 2 } },
    );
    expect(Object.keys(built.facetShards.price?.values ?? {})).toEqual([
      "0-50",
      "50+",
    ]);
    expect(Object.keys(built.facetShards.score?.values ?? {})).toEqual([
      "0-20",
      "20-40",
      "40-60",
      "60-80",
      "80+",
    ]);
  });

  it("treats a bucket count of 1 as a single overall bucket, distinct from the single-distinct-value collapse", () => {
    const evenlySpread: SourceDocument[] = [0, 25, 50, 75, 100].map(
      (value, i) => ({
        id: i + 1,
        url: `/${i}`,
        html: `<html lang="en"><head><title>Doc ${i}</title>
          <meta name="csf-facet-range-score" content="${value}"></head>
          <body><main>x</main></body></html>`,
      }),
    );
    const built = buildIndex(evenlySpread, "en", {
      rangeFacetBuckets: { score: 1 },
    });
    expect(built.facetShards.score?.values).toEqual({
      "0+": { count: 5, docs: [1, 2, 3, 4, 5] },
    });
  });

  it("throws for a non-positive or non-integer rangeFacetBuckets count", () => {
    const source: SourceDocument[] = [
      {
        id: 1,
        url: "/a",
        html: `<html lang="en"><head><title>A</title>
          <meta name="csf-facet-range-price" content="10"></head>
          <body><main>a</main></body></html>`,
      },
    ];
    expect(() =>
      buildIndex(source, "en", { rangeFacetBuckets: { price: 0 } }),
    ).toThrow(/positive integer/);
    expect(() =>
      buildIndex(source, "en", { rangeFacetBuckets: { price: -1 } }),
    ).toThrow(/positive integer/);
    expect(() =>
      buildIndex(source, "en", { rangeFacetBuckets: { price: 2.5 } }),
    ).toThrow(/positive integer/);
  });

  it("honors explicit ascending boundaries instead of equal-width buckets", () => {
    const priceSources: SourceDocument[] = [10, 30, 60, 150, 300].map(
      (value, i) => ({
        id: i + 1,
        url: `/${i}`,
        html: `<html lang="en"><head><title>Doc ${i}</title>
        <meta name="csf-facet-range-price" content="${value}"></head>
        <body><main>x</main></body></html>`,
      }),
    );
    const built = buildIndex(priceSources, "en", {
      rangeFacetBuckets: { price: [25, 50, 100, 250] },
    });
    // 10 -> <25; 30 -> 25-50; 60 -> 50-100; 150 -> 100-250; 300 -> 250+
    expect(built.facetShards.price?.values).toEqual({
      "<25": { count: 1, docs: [1] },
      "25-50": { count: 1, docs: [2] },
      "50-100": { count: 1, docs: [3] },
      "100-250": { count: 1, docs: [4] },
      "250+": { count: 1, docs: [5] },
    });
  });

  it("groups multiple values into the same explicit-boundary bucket", () => {
    const priceSources: SourceDocument[] = [5, 10, 15, 40].map((value, i) => ({
      id: i + 1,
      url: `/${i}`,
      html: `<html lang="en"><head><title>Doc ${i}</title>
          <meta name="csf-facet-range-price" content="${value}"></head>
          <body><main>x</main></body></html>`,
    }));
    const built = buildIndex(priceSources, "en", {
      rangeFacetBuckets: { price: [25] },
    });
    expect(built.facetShards.price?.values).toEqual({
      "<25": { count: 3, docs: [1, 2, 3] },
      "25+": { count: 1, docs: [4] },
    });
  });

  it("does not collapse a single-distinct-value corpus into one bucket under explicit boundaries (unlike equal-width)", () => {
    const built = buildIndex(
      [
        {
          id: 1,
          url: "/a",
          html: `<html lang="en"><head><title>A</title>
            <meta name="csf-facet-range-price" content="42"></head>
            <body><main>a</main></body></html>`,
        },
        {
          id: 2,
          url: "/b",
          html: `<html lang="en"><head><title>B</title>
            <meta name="csf-facet-range-price" content="42"></head>
            <body><main>b</main></body></html>`,
        },
      ],
      "en",
      { rangeFacetBuckets: { price: [25, 50] } },
    );
    // Every value is the same (42), but the fixed brackets still apply
    // -- 42 falls in "25-50", not a single degenerate bucket labeled "42".
    expect(built.facetShards.price?.values).toEqual({
      "25-50": { count: 2, docs: [1, 2] },
    });
  });

  it("throws for an empty, non-finite, or non-ascending boundaries array", () => {
    const source: SourceDocument[] = [
      {
        id: 1,
        url: "/a",
        html: `<html lang="en"><head><title>A</title>
          <meta name="csf-facet-range-price" content="10"></head>
          <body><main>a</main></body></html>`,
      },
    ];
    expect(() =>
      buildIndex(source, "en", { rangeFacetBuckets: { price: [] } }),
    ).toThrow(/non-empty array/);
    expect(() =>
      buildIndex(source, "en", {
        rangeFacetBuckets: { price: [Number.NaN] },
      }),
    ).toThrow(/non-empty array/);
    expect(() =>
      buildIndex(source, "en", { rangeFacetBuckets: { price: [50, 25] } }),
    ).toThrow(/strictly ascending/);
    expect(() =>
      buildIndex(source, "en", { rangeFacetBuckets: { price: [25, 25] } }),
    ).toThrow(/strictly ascending/);
  });
});

describe("buildIndex hierarchical facets", () => {
  const hierarchySources: SourceDocument[] = [
    {
      id: 1,
      url: "/headphones",
      html: `<html lang="en"><head><title>Headphones</title>
        <meta name="csf-facet-category" content="electronics>audio>headphones"></head>
        <body><main>a</main></body></html>`,
    },
    {
      id: 2,
      url: "/speakers",
      html: `<html lang="en"><head><title>Speakers</title>
        <meta name="csf-facet-category" content="electronics>audio>speakers"></head>
        <body><main>b</main></body></html>`,
    },
    {
      id: 3,
      url: "/tv",
      html: `<html lang="en"><head><title>TV</title>
        <meta name="csf-facet-category" content="electronics>video>tv"></head>
        <body><main>c</main></body></html>`,
    },
    {
      id: 4,
      url: "/books",
      html: `<html lang="en"><head><title>Books</title>
        <meta name="csf-facet-category" content="books"></head>
        <body><main>d</main></body></html>`,
    },
  ];

  it("tags the shard as type: hierarchy with the default '>' separator when configured", () => {
    const built = buildIndex(hierarchySources, "en", {
      hierarchicalFacets: { category: {} },
    });
    expect(built.facetShards.category?.type).toBe("hierarchy");
    expect(built.facetShards.category?.separator).toBe(">");
  });

  it("indexes every ancestor path plus the leaf as its own addressable entry", () => {
    const built = buildIndex(hierarchySources, "en", {
      hierarchicalFacets: { category: {} },
    });
    expect(built.facetShards.category?.values).toEqual({
      electronics: { count: 3, docs: [1, 2, 3] },
      "electronics>audio": { count: 2, docs: [1, 2] },
      "electronics>audio>headphones": { count: 1, docs: [1] },
      "electronics>audio>speakers": { count: 1, docs: [2] },
      "electronics>video": { count: 1, docs: [3] },
      "electronics>video>tv": { count: 1, docs: [3] },
      books: { count: 1, docs: [4] },
    });
  });

  it("counts a doc only once at a shared ancestor level even when the doc has two paths under it", () => {
    const built = buildIndex(
      [
        {
          id: 1,
          url: "/a",
          html: `<html lang="en"><head><title>A</title>
            <meta name="csf-facet-category" content="electronics>audio>headphones">
            <meta name="csf-facet-category" content="electronics>video>tv"></head>
            <body><main>a</main></body></html>`,
        },
      ],
      "en",
      { hierarchicalFacets: { category: {} } },
    );
    // Doc 1 declares two distinct leaf paths sharing the "electronics"
    // ancestor -- that ancestor must still count doc 1 exactly once,
    // not twice, since it's the same document appearing under it.
    expect(built.facetShards.category?.values.electronics).toEqual({
      count: 1,
      docs: [1],
    });
  });

  it("honors a custom per-field separator", () => {
    const built = buildIndex(
      [
        {
          id: 1,
          url: "/a",
          html: `<html lang="en"><head><title>A</title>
            <meta name="csf-facet-category" content="electronics/audio/headphones"></head>
            <body><main>a</main></body></html>`,
        },
      ],
      "en",
      { hierarchicalFacets: { category: { separator: "/" } } },
    );
    expect(built.facetShards.category?.separator).toBe("/");
    expect(built.facetShards.category?.values).toEqual({
      electronics: { count: 1, docs: [1] },
      "electronics/audio": { count: 1, docs: [1] },
      "electronics/audio/headphones": { count: 1, docs: [1] },
    });
  });

  it("treats a value with no separator in it as a single top-level entry", () => {
    const built = buildIndex(hierarchySources, "en", {
      hierarchicalFacets: { category: {} },
    });
    expect(built.facetShards.category?.values.books).toEqual({
      count: 1,
      docs: [4],
    });
  });

  it("builds an ordinary terms facet, unaffected, for a field not listed in hierarchicalFacets", () => {
    const built = buildIndex(hierarchySources); // no hierarchicalFacets option at all
    expect(built.facetShards.category?.type).toBe("terms");
    expect(
      built.facetShards.category?.values["electronics>audio>headphones"],
    ).toEqual({ count: 1, docs: [1] });
    expect(built.facetShards.category?.values.electronics).toBeUndefined();
  });

  it("lists a hierarchical facet field on the manifest same as any other facet field", () => {
    const built = buildIndex(hierarchySources, "en", {
      hierarchicalFacets: { category: {} },
    });
    expect(built.manifest.facetFields).toEqual(["category"]);
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
    // Normalized the same way any other indexed term is (lowercased and
    // stemmed via the English profile) -- "pricing plans" stems to
    // "price plan" (docs/03-tokenization-i18n.md#stemming).
    expect(built.pinsShards.en?.["price plan"]).toEqual({
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
    // "pricing" stems to "price" (docs/03-tokenization-i18n.md#stemming).
    expect(built.pinsShards.en?.price?.docs.map((d) => d.id)).toEqual([
      2, 3, 1,
    ]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('pin conflict: "price"'),
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
    // "widgets" stems to "widget" (English); "Preise" stems to "preis"
    // (German) -- both real stemmers, docs/03-tokenization-i18n.md#stemming.
    expect(built.termShards.en?.widget).toBeDefined();
    expect(built.termShards.de?.widget).toBeUndefined();
    expect(built.termShards.de?.preis).toBeDefined();
    expect(built.termShards.en?.preis).toBeUndefined();
  });

  it("falls back a document without <html lang> to the corpus's default language", () => {
    const built = buildIndex(mixedSources, "en");
    // "untitled" stems to "untitl".
    expect(built.termShards.en?.untitl?.postings.map((p) => p.doc)).toEqual([
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

describe("buildIndex CJK bigram fallback (docs/03-tokenization-i18n.md#segmentation)", () => {
  const cjkSources: SourceDocument[] = [
    {
      id: 1,
      url: "/zh/nlp",
      html: `<html lang="zh"><head><title>自然語言處理</title></head>
        <body><main><p>自然語言處理是電腦科學的一個領域。</p></main></body></html>`,
    },
    {
      id: 2,
      url: "/zh/cooking",
      html: `<html lang="zh"><head><title>中式烹飪</title></head>
        <body><main><p>中式烹飪注重色香味俱全。</p></main></body></html>`,
    },
  ];

  it("indexes a CJK document's title/body as overlapping bigrams under that document's own language shard", () => {
    const built = buildIndex(cjkSources, "zh");
    // "自然語言處理" (title) -> bigrams 自然/然語/語言/言處/處理, each a
    // real term-shard key -- no word-boundary dictionary needed.
    expect(built.termShards.zh?.自然).toBeDefined();
    expect(built.termShards.zh?.語言).toBeDefined();
    expect(built.termShards.zh?.處理).toBeDefined();
  });

  it("does not put a bigram from one document into an unrelated document's postings", () => {
    const built = buildIndex(cjkSources, "zh");
    // "語言" (from doc 1's title) never appears in doc 2's cooking content.
    expect(built.termShards.zh?.語言?.postings.map((p) => p.doc)).toEqual([1]);
    expect(built.termShards.zh?.中式?.postings.map((p) => p.doc)).toEqual([2]);
  });

  it("computes docCount/avgFieldLength for the zh partition like any other language", () => {
    const built = buildIndex(cjkSources, "zh");
    expect(built.manifest.docCount.zh).toBe(2);
    expect(built.manifest.avgFieldLength.zh?.title).toBeGreaterThan(0);
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
    // "Settee" stems to "sette" (docs/03-tokenization-i18n.md#stemming).
    expect(built.synonymShards.en?.equivalences).toEqual([
      ["sofa", "couch", "sette"],
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

  it("normalizes multiWord phrase groups as whole units, not per-word", () => {
    const built = buildIndex(minimalSources, "en", {
      synonyms: {
        en: { multiWord: [["New York", "NYC", "Big Apple"]] },
      },
    });
    // "Big Apple" -> "big appl" (space-joined, each word stemmed
    // independently but the phrase kept as one normalized string).
    expect(built.synonymShards.en?.multiWord).toEqual([
      ["new york", "nyc", "big appl"],
    ]);
  });

  it("drops a multiWord group left with fewer than two distinct members after normalizing", () => {
    // Both entries normalize to the same phrase, so nothing is left to expand to.
    const built = buildIndex(minimalSources, "en", {
      synonyms: { en: { multiWord: [["New York", "new york"]] } },
    });
    expect(built.synonymShards.en?.multiWord).toBeUndefined();
  });

  it("omits multiWord entirely when empty, alongside equivalences/directional", () => {
    const built = buildIndex(minimalSources, "en", {
      synonyms: { en: { multiWord: [] } },
    });
    expect(built.synonymShards.en).toEqual({});
  });

  it("keeps multiWord data alongside equivalences/directional in the same shard", () => {
    const built = buildIndex(minimalSources, "en", {
      synonyms: {
        en: {
          equivalences: [["sofa", "couch"]],
          multiWord: [["new york", "nyc"]],
        },
      },
    });
    expect(built.synonymShards.en).toEqual({
      equivalences: [["sofa", "couch"]],
      multiWord: [["new york", "nyc"]],
    });
  });
});

describe("buildIndex fuzzy dictionary", () => {
  const widgetSources: SourceDocument[] = [
    {
      id: 1,
      url: "/a",
      html: `<html lang="en"><head><title>Widgets</title></head><body><main>x</main></body></html>`,
    },
  ];

  it("builds no fuzzy shards at all by default", () => {
    const built = buildIndex(widgetSources);
    expect(built.fuzzyShards).toEqual({});
  });

  it("builds a maxEdits:1 deletion dictionary per language when fuzzy:true", () => {
    const built = buildIndex(widgetSources, "en", { fuzzy: true });
    expect(built.fuzzyShards.en?.maxEdits).toBe(1);
    // "Widgets" stems to the real indexed term "widget"
    // (docs/03-tokenization-i18n.md#stemming); "widge" (drop the
    // trailing "t") is one of its one-character-deleted variants.
    expect(built.fuzzyShards.en?.deletions.widge).toContain("widget");
  });

  it("maps a term's own identity (0 deletions) back to itself", () => {
    const built = buildIndex(widgetSources, "en", { fuzzy: true });
    expect(built.fuzzyShards.en?.deletions.widget).toContain("widget");
  });

  it("collapses multiple real terms that collide on the same deletion variant", () => {
    const built = buildIndex(
      [
        {
          id: 1,
          url: "/a",
          html: `<html lang="en"><head><title>Cat Car</title></head><body><main>x</main></body></html>`,
        },
      ],
      "en",
      { fuzzy: true },
    );
    // Deleting the trailing letter from either "cat" or "car" gives "ca"
    // -- both real (and here, already-stem-form) terms should map there.
    expect(built.fuzzyShards.en?.deletions.ca?.sort()).toEqual(["car", "cat"]);
  });

  it("keeps fuzzy dictionaries separate per language", () => {
    const built = buildIndex(
      [
        widgetSources[0] as SourceDocument,
        {
          id: 2,
          url: "/b",
          html: `<html lang="de"><head><title>Katze</title></head><body><main>x</main></body></html>`,
        },
      ],
      "en",
      { fuzzy: true },
    );
    // "Katze" stems to "katz" (docs/03-tokenization-i18n.md#stemming),
    // so that's the real indexed term the deletion dictionary is built
    // from -- "katz" itself is one of its own 0-deletion variants.
    expect(built.fuzzyShards.en?.deletions.katz).toBeUndefined();
    expect(built.fuzzyShards.de?.deletions.widget).toBeUndefined();
    expect(built.fuzzyShards.de?.deletions.katz).toContain("katz");
  });

  it("defaults to maxEdits:1 when fuzzyMaxEdits is not given", () => {
    const built = buildIndex(widgetSources, "en", { fuzzy: true });
    expect(built.fuzzyShards.en?.maxEdits).toBe(1);
  });

  it("builds deletion-of-a-deletion variants too when fuzzyMaxEdits: 2", () => {
    const built = buildIndex(widgetSources, "en", {
      fuzzy: true,
      fuzzyMaxEdits: 2,
    });
    expect(built.fuzzyShards.en?.maxEdits).toBe(2);
    // "widg" is "widget" with both trailing characters ("e","t") deleted
    // -- only reachable by deleting from an already-deleted variant
    // (e.g. "widge" -> "widg"), not a direct single deletion of
    // "widget" itself.
    expect(built.fuzzyShards.en?.deletions.widg).toContain("widget");
  });

  it("does not build depth-2 variants when fuzzyMaxEdits is left at the default 1", () => {
    const built = buildIndex(widgetSources, "en", { fuzzy: true });
    expect(built.fuzzyShards.en?.deletions.widg).toBeUndefined();
  });

  it("throws for a fuzzyMaxEdits value other than 1 or 2", () => {
    expect(() =>
      buildIndex(widgetSources, "en", {
        fuzzy: true,
        // @ts-expect-error -- deliberately an invalid runtime value
        fuzzyMaxEdits: 3,
      }),
    ).toThrow(/must be 1 or 2/);
  });
});
