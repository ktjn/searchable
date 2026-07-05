import { english } from "@csf/analysis";
import { describe, expect, it } from "vitest";
import { parseQueryTerms } from "../src/parse-query.js";

describe("parseQueryTerms", () => {
  it("parses plain terms as non-prefix", () => {
    const terms = parseQueryTerms("gadgets gizmos", english);
    expect(terms).toEqual([
      { term: "gadgets", prefix: false },
      { term: "gizmos", prefix: false },
    ]);
  });

  it("detects a trailing * as a prefix query and strips it", () => {
    const terms = parseQueryTerms("widg*", english);
    expect(terms).toEqual([{ term: "widg", prefix: true }]);
  });

  it("mixes exact and prefix terms in one query", () => {
    const terms = parseQueryTerms("gadgets widg*", english);
    expect(terms).toEqual([
      { term: "gadgets", prefix: false },
      { term: "widg", prefix: true },
    ]);
  });

  it("lowercases a prefix term like any other term", () => {
    const terms = parseQueryTerms("WIDG*", english);
    expect(terms).toEqual([{ term: "widg", prefix: true }]);
  });

  it("does not treat a bare * as a prefix marker", () => {
    const terms = parseQueryTerms("*", english);
    expect(terms).toEqual([]);
  });

  it("dedupes repeated terms of the same kind", () => {
    const terms = parseQueryTerms("widgets widgets", english);
    expect(terms).toEqual([{ term: "widgets", prefix: false }]);
  });

  it("keeps an exact and a prefix form of the same text as distinct clauses", () => {
    const terms = parseQueryTerms("widget widget*", english);
    expect(terms).toEqual([
      { term: "widget", prefix: false },
      { term: "widget", prefix: true },
    ]);
  });
});
