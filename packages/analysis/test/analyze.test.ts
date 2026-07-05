import { describe, expect, it } from "vitest";
import { analyze, english } from "../src/index.js";

describe("analyze (english)", () => {
  it("splits on word boundaries and lowercases", () => {
    const tokens = analyze("The Quick, Brown Fox!", english);
    expect(tokens.map((t) => t.term)).toEqual(["the", "quick", "brown", "fox"]);
  });

  it("assigns sequential positions to word tokens only", () => {
    const tokens = analyze("one two three", english);
    expect(tokens.map((t) => t.position)).toEqual([0, 1, 2]);
  });

  it("is stable across repeated calls (index/query parity)", () => {
    const a = analyze("Widgets are wonderful widgets.", english);
    const b = analyze("Widgets are wonderful widgets.", english);
    expect(a).toEqual(b);
  });

  it("does not stem or drop stopwords by default", () => {
    const tokens = analyze("the running dogs", english);
    expect(tokens.map((t) => t.term)).toEqual(["the", "running", "dogs"]);
  });
});
