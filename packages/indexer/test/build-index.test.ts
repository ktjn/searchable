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
];

describe("buildIndex", () => {
  it("indexes documents and produces correct postings", () => {
    const built = buildIndex(sources);
    expect(built.manifest.docCount).toBe(2); // draft excluded
    expect(built.termShard.widgets.df).toBe(2);
    expect(built.termShard.widgets.postings.map((p) => p.doc).sort()).toEqual([
      1, 2,
    ]);
    expect(built.termShard.gizmos.df).toBe(1);
    expect(built.termShard.gizmos.postings[0]?.doc).toBe(2);
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
    // doc 1 title "Widgets" = 1 token, doc 2 title "Gadgets" = 1 token
    expect(built.manifest.avgFieldLength.title).toBe(1);
  });

  it("stores title and a derived excerpt in the doc store", () => {
    const built = buildIndex(sources);
    expect(built.docStore["1"]?.url).toBe("/widgets");
    expect(built.docStore["1"]?.fields.title).toBe("Widgets");
    expect(built.docStore["1"]?.fields.excerpt).toContain("wonderful widgets");
  });
});
