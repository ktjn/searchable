import { describe, expect, it } from "vitest";
import { chunkText } from "../src/chunk-text.js";

describe("chunkText", () => {
  it("returns no chunks for empty or whitespace-only text", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\t  ")).toEqual([]);
  });

  it("returns exactly one chunk for text shorter than chunkTokens", () => {
    const text = "a short document about widgets";
    const chunks = chunkText(text, 200, 20);
    expect(chunks).toEqual([{ index: 0, text }]);
  });

  it("splits a long text into overlapping windows with the configured stride", () => {
    const words = Array.from({ length: 25 }, (_, i) => `w${i}`);
    const text = words.join(" ");
    const chunks = chunkText(text, 10, 3);
    // stride = 10 - 3 = 7; starts at 0, 7, 14, 21 (21 + 10 >= 25, so it's the last).
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2, 3]);
    expect(chunks[0]?.text).toBe(words.slice(0, 10).join(" "));
    expect(chunks[1]?.text).toBe(words.slice(7, 17).join(" "));
    expect(chunks[2]?.text).toBe(words.slice(14, 24).join(" "));
    expect(chunks[3]?.text).toBe(words.slice(21, 25).join(" "));
  });

  it("has real word overlap between consecutive chunks matching overlapTokens", () => {
    const words = Array.from({ length: 50 }, (_, i) => `w${i}`);
    const chunks = chunkText(words.join(" "), 20, 5);
    for (let i = 1; i < chunks.length; i++) {
      const prevWords = (chunks[i - 1]?.text ?? "").split(" ");
      const currWords = (chunks[i]?.text ?? "").split(" ");
      const overlap = prevWords.slice(-5);
      expect(currWords.slice(0, 5)).toEqual(overlap);
    }
  });

  it("collapses arbitrary whitespace between words", () => {
    const chunks = chunkText("alpha   beta\n\tgamma", 200, 20);
    expect(chunks).toEqual([{ index: 0, text: "alpha beta gamma" }]);
  });

  it("uses the documented defaults (200 tokens, 20-token overlap) when not given", () => {
    const words = Array.from({ length: 210 }, (_, i) => `w${i}`);
    const chunks = chunkText(words.join(" "));
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.text).toBe(words.slice(0, 200).join(" "));
    expect(chunks[1]?.text).toBe(words.slice(180, 210).join(" "));
  });
});
