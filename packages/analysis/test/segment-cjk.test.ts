import { describe, expect, it } from "vitest";
import { segmentCjkBigram } from "../src/segment-cjk.js";

describe("segmentCjkBigram", () => {
  it("splits a run of CJK characters into overlapping bigrams", () => {
    const spans = segmentCjkBigram("自然語言");
    expect(spans).toEqual([
      { text: "自然", isWordLike: true },
      { text: "然語", isWordLike: true },
      { text: "語言", isWordLike: true },
    ]);
  });

  it("indexes a lone single-character CJK run as that one character, not dropped", () => {
    expect(segmentCjkBigram("深")).toEqual([{ text: "深", isWordLike: true }]);
  });

  it("segments hiragana and katakana the same way as Han ideographs", () => {
    expect(segmentCjkBigram("こんにちは")).toEqual([
      { text: "こん", isWordLike: true },
      { text: "んに", isWordLike: true },
      { text: "にち", isWordLike: true },
      { text: "ちは", isWordLike: true },
    ]);
  });

  it("segments a non-CJK run normally (Latin words stay whole, whitespace is not word-like)", () => {
    const spans = segmentCjkBigram("深度learning");
    expect(spans).toEqual([
      { text: "深度", isWordLike: true },
      { text: "learning", isWordLike: true },
    ]);
  });

  it("keeps CJK bigrams and Latin words separate across a whitespace boundary", () => {
    const spans = segmentCjkBigram("電腦 and 手機");
    expect(spans.filter((s) => s.isWordLike).map((s) => s.text)).toEqual([
      "電腦",
      "and",
      "手機",
    ]);
  });

  it("is stable across repeated calls (index/query parity)", () => {
    const a = segmentCjkBigram("自然語言處理");
    const b = segmentCjkBigram("自然語言處理");
    expect(a).toEqual(b);
  });

  it("returns an empty array for an empty string", () => {
    expect(segmentCjkBigram("")).toEqual([]);
  });
});
