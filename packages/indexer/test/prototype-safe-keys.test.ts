import { describe, expect, it } from "vitest";
import { buildIndex } from "../src/build-index.js";
import type { SourceDocument } from "../src/types.js";

/**
 * `Object.prototype` member names ("constructor", "toString",
 * "hasOwnProperty", ...) are ordinary English words that can appear in
 * real prose. Every plain-object dictionary buildIndex populates
 * (term shards, fuzzy deletion dictionaries, facet shards) is keyed by
 * corpus-derived strings, so a naive `if (!dict[key])` existence check
 * is silently fooled into reading the inherited prototype member
 * instead of creating a real entry -- this is the exact bug
 * docs/reference/compatibility.md's own text (containing the word
 * "constructor") triggered when the showcase indexed it. These tests
 * pin that buildIndex handles every such key correctly rather than
 * crashing or silently dropping the entry. `Object.hasOwn()` confirms
 * each is a real *own* property (not inherited) before reading it via
 * plain dot access.
 */
describe("buildIndex with Object.prototype-colliding content", () => {
  const sources: SourceDocument[] = [
    {
      id: 1,
      url: "/a",
      html: `<html lang="en"><head><title>Constructor</title></head>
        <body><main><p>A constructor is a special method.</p></main></body></html>`,
    },
  ];

  it("indexes a document whose text contains 'constructor' without throwing, with a real, own-property term entry", () => {
    const built = buildIndex(sources);
    const termShard = built.manifest.languages.includes("en")
      ? built.termShards.en
      : undefined;
    expect(termShard).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: asserted defined above
    const shard = termShard!;
    expect(Object.hasOwn(shard, "constructor")).toBe(true);
    const entry = shard.constructor;
    expect(Array.isArray(entry?.postings)).toBe(true);
    expect(entry?.postings.map((p) => p.doc)).toEqual([1]);
    expect(entry?.df).toBe(1);
  });

  it("builds a fuzzy deletion dictionary over a 'constructor' vocabulary without throwing", () => {
    const built = buildIndex(sources, "en", { fuzzy: true });
    expect(built.fuzzyShards.en?.deletions.constructor).toContain(
      "constructor",
    );
  });

  it("handles a facet field literally named 'constructor' with a 'toString' value", () => {
    const facetSources: SourceDocument[] = [
      {
        id: 1,
        url: "/a",
        html: `<html lang="en"><head><title>A</title>
          <meta name="searchable-facet-constructor" content="toString"></head>
          <body><main><p>x</p></main></body></html>`,
      },
    ];
    const built = buildIndex(facetSources);
    expect(Object.hasOwn(built.facetShards, "constructor")).toBe(true);
    const shard = built.facetShards.constructor;
    expect(shard?.type).toBe("terms");
    expect(Object.hasOwn(shard?.values ?? {}, "toString")).toBe(true);
    expect(shard?.values.toString?.count).toBe(1);
    expect(shard?.values.toString?.docs).toEqual([1]);
  });

  it("handles a range facet field literally named 'hasOwnProperty'", () => {
    const rangeSources: SourceDocument[] = [
      {
        id: 1,
        url: "/a",
        html: `<html lang="en"><head><title>A</title>
          <meta name="searchable-facet-range-hasOwnProperty" content="42"></head>
          <body><main><p>x</p></main></body></html>`,
      },
    ];
    const built = buildIndex(rangeSources);
    expect(Object.hasOwn(built.facetShards, "hasOwnProperty")).toBe(true);
    expect(built.facetShards.hasOwnProperty?.type).toBe("range");
    expect(built.facetShards.hasOwnProperty?.sorted).toEqual([
      { value: 42, doc: 1 },
    ]);
  });
});
