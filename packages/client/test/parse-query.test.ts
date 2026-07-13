import { english } from "@ktjn/searchable-analysis";
import { describe, expect, it } from "vitest";
import { parseQuery, parseQueryTerms } from "../src/parse-query.js";

describe("parseQueryTerms", () => {
  it("parses plain terms as non-prefix", () => {
    const terms = parseQueryTerms("gadgets gizmos", english);
    expect(terms).toEqual([
      { term: "gadget", literal: "gadgets", prefix: false },
      { term: "gizmo", literal: "gizmos", prefix: false },
    ]);
  });

  it("detects a trailing * as a prefix query and strips it", () => {
    const terms = parseQueryTerms("widg*", english);
    expect(terms).toEqual([{ term: "widg", literal: "widg", prefix: true }]);
  });

  it("mixes exact and prefix terms in one query", () => {
    const terms = parseQueryTerms("gadgets widg*", english);
    expect(terms).toEqual([
      { term: "gadget", literal: "gadgets", prefix: false },
      { term: "widg", literal: "widg", prefix: true },
    ]);
  });

  it("lowercases a prefix term like any other term", () => {
    const terms = parseQueryTerms("WIDG*", english);
    expect(terms).toEqual([{ term: "widg", literal: "widg", prefix: true }]);
  });

  it("does not treat a bare * as a prefix marker", () => {
    const terms = parseQueryTerms("*", english);
    expect(terms).toEqual([]);
  });

  it("dedupes repeated terms of the same kind", () => {
    const terms = parseQueryTerms("widgets widgets", english);
    expect(terms).toEqual([
      { term: "widget", literal: "widgets", prefix: false },
    ]);
  });

  it("keeps an exact and a prefix form of the same text as distinct clauses", () => {
    const terms = parseQueryTerms("widget widget*", english);
    expect(terms).toEqual([
      { term: "widget", literal: "widget", prefix: false },
      { term: "widget", literal: "widget", prefix: true },
    ]);
  });

  it("preserves the literal (unstemmed) surface form separately from the stemmed term", () => {
    const terms = parseQueryTerms("running", english);
    expect(terms).toEqual([{ term: "run", literal: "running", prefix: false }]);
  });
});

describe("parseQuery", () => {
  it("extracts a quoted phrase into its own clause, separate from plain terms", () => {
    const parsed = parseQuery(
      'wireless "noise cancelling" headphones',
      english,
    );
    expect(parsed.terms).toEqual([
      { term: "wireless", literal: "wireless", prefix: false },
      { term: "headphon", literal: "headphones", prefix: false },
    ]);
    expect(parsed.phrases).toEqual([
      {
        terms: [
          { term: "nois", literal: "noise", prefix: false },
          { term: "cancel", literal: "cancelling", prefix: false },
        ],
      },
    ]);
  });

  it("supports multiple quoted phrases in one query", () => {
    const parsed = parseQuery('"new york" "los angeles"', english);
    expect(parsed.terms).toEqual([]);
    expect(parsed.phrases).toEqual([
      {
        terms: [
          { term: "new", literal: "new", prefix: false },
          { term: "york", literal: "york", prefix: false },
        ],
      },
      {
        terms: [
          { term: "lo", literal: "los", prefix: false },
          { term: "angel", literal: "angeles", prefix: false },
        ],
      },
    ]);
  });

  it("treats a query with no quotes identically to parseQueryTerms, with no phrases", () => {
    const parsed = parseQuery("gadgets widg*", english);
    expect(parsed.terms).toEqual(parseQueryTerms("gadgets widg*", english));
    expect(parsed.phrases).toEqual([]);
  });

  it("a single-word quoted phrase degenerates to a one-term phrase clause", () => {
    const parsed = parseQuery('"widget"', english);
    expect(parsed.terms).toEqual([]);
    expect(parsed.phrases).toEqual([
      { terms: [{ term: "widget", literal: "widget", prefix: false }] },
    ]);
  });

  it("silently ignores an empty quoted phrase", () => {
    const parsed = parseQuery('widget ""', english);
    expect(parsed.terms).toEqual([
      { term: "widget", literal: "widget", prefix: false },
    ]);
    expect(parsed.phrases).toEqual([]);
  });

  it("silently falls through to plain term parsing for an unterminated quote", () => {
    const parsed = parseQuery('widget "gadgets', english);
    expect(parsed.terms).toEqual([
      { term: "widget", literal: "widget", prefix: false },
      { term: "gadget", literal: "gadgets", prefix: false },
    ]);
    expect(parsed.phrases).toEqual([]);
  });
});
