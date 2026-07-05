import { describe, expect, it } from "vitest";
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
    expect(built.manifest.docCount).toBe(3); // draft excluded
    expect(built.termShard.widgets.df).toBe(3);
    expect(built.termShard.widgets.postings.map((p) => p.doc).sort()).toEqual([
      1, 2, 4,
    ]);
    expect(built.termShard.gizmos.df).toBe(1);
    expect(built.termShard.gizmos.postings[0]?.doc).toBe(2);
  });

  it("sets posting-level boost from csf-boost, omitting it when default", () => {
    const built = buildIndex(sources);
    const boosted = built.termShard.widgets.postings.find((p) => p.doc === 4);
    const unboosted = built.termShard.widgets.postings.find((p) => p.doc === 1);
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
    expect(built.termShard.draft).toBeUndefined();
  });

  it("records per-field term frequency and positions", () => {
    const built = buildIndex(sources);
    const posting = built.termShard.widgets.postings.find((p) => p.doc === 1);
    // doc 1's title is literally "Widgets", so it appears in both fields
    expect(posting?.fields.title).toEqual({ tf: 1, pos: [0], len: 1 });
    expect(posting?.fields.body).toEqual({ tf: 1, pos: [3], len: 6 });
  });

  it("computes avgFieldLength across indexed (non-noindex) docs only", () => {
    const built = buildIndex(sources);
    // titles: "Widgets"=1, "Gadgets"=1, "Featured Widgets"=2 tokens -> 4/3
    expect(built.manifest.avgFieldLength.title).toBeCloseTo(4 / 3);
  });

  it("stores title and a derived excerpt in the doc store", () => {
    const built = buildIndex(sources);
    expect(built.docStore["1"]?.url).toBe("/widgets");
    expect(built.docStore["1"]?.fields.title).toBe("Widgets");
    expect(built.docStore["1"]?.fields.excerpt).toContain("wonderful widgets");
  });
});
