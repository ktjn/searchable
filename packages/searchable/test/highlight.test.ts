import { describe, expect, it } from "vitest";
import { highlightText } from "../src/highlight.js";

describe("highlightText", () => {
  it("returns a single non-match span when there are no terms", () => {
    expect(highlightText("hello world", [])).toEqual([
      { text: "hello world", isMatch: false },
    ]);
  });

  it("returns a single non-match span for empty text", () => {
    expect(highlightText("", [{ term: "hello", prefix: false }])).toEqual([
      { text: "", isMatch: false },
    ]);
  });

  it("splits text around a single case-insensitive match", () => {
    expect(
      highlightText("Our Widgets are wonderful", [
        { term: "widgets", prefix: false },
      ]),
    ).toEqual([
      { text: "Our ", isMatch: false },
      { text: "Widgets", isMatch: true },
      { text: " are wonderful", isMatch: false },
    ]);
  });

  it("matches every occurrence of a term, not just the first", () => {
    expect(
      highlightText("widget widget widget", [
        { term: "widget", prefix: false },
      ]),
    ).toEqual([
      { text: "widget", isMatch: true },
      { text: " ", isMatch: false },
      { text: "widget", isMatch: true },
      { text: " ", isMatch: false },
      { text: "widget", isMatch: true },
    ]);
  });

  it("highlights every distinct term across multiple query terms", () => {
    const spans = highlightText("The widget and the gadget", [
      { term: "widget", prefix: false },
      { term: "gadget", prefix: false },
    ]);
    expect(spans.filter((s) => s.isMatch).map((s) => s.text)).toEqual([
      "widget",
      "gadget",
    ]);
  });

  it("matches a whole word's worth of characters for a prefix term", () => {
    expect(
      highlightText("widgets and widgetry", [{ term: "widget", prefix: true }]),
    ).toEqual([
      { text: "widgets", isMatch: true },
      { text: " and ", isMatch: false },
      { text: "widgetry", isMatch: true },
    ]);
  });

  it("does not match a prefix term's word as a substring mid-word", () => {
    // "widget" as an exact (non-prefix) term must not match inside "widgetry".
    const spans = highlightText("widgetry", [
      { term: "widget", prefix: false },
    ]);
    expect(spans.every((s) => !s.isMatch)).toBe(true);
  });

  it("never highlights a term that does not appear in the text", () => {
    const spans = highlightText("completely unrelated text", [
      { term: "widget", prefix: false },
    ]);
    expect(spans).toEqual([
      { text: "completely unrelated text", isMatch: false },
    ]);
  });

  it("prefers the longest term when one term is a substring of another", () => {
    const spans = highlightText("category", [
      { term: "cat", prefix: false },
      { term: "category", prefix: false },
    ]);
    expect(spans).toEqual([{ text: "category", isMatch: true }]);
  });

  it("escapes regex-special characters in a term rather than treating them as patterns", () => {
    // An unescaped "node.js" pattern would treat "." as "any character"
    // and incorrectly match "nodeXjs" too.
    const matched = highlightText("we use node.js in production", [
      { term: "node.js", prefix: false },
    ]);
    expect(matched.some((s) => s.isMatch && s.text === "node.js")).toBe(true);

    const notMatched = highlightText("nodeXjs is not the same thing", [
      { term: "node.js", prefix: false },
    ]);
    expect(notMatched.every((s) => !s.isMatch)).toBe(true);
  });
});
