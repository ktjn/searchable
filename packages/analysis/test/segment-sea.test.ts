import { describe, expect, it } from "vitest";
import { segmentSeaTrigram } from "../src/segment-sea.js";

describe("segmentSeaTrigram", () => {
  it("splits a run of Thai characters into overlapping trigrams", () => {
    expect(segmentSeaTrigram("สวัสดี")).toEqual([
      { text: "สวั", isWordLike: true },
      { text: "วัส", isWordLike: true },
      { text: "ัสด", isWordLike: true },
      { text: "สดี", isWordLike: true },
    ]);
  });

  it("segments Khmer text the same trigram way", () => {
    expect(segmentSeaTrigram("សួស្តី")).toEqual([
      { text: "សួស", isWordLike: true },
      { text: "ួស្", isWordLike: true },
      { text: "ស្ត", isWordLike: true },
      { text: "្តី", isWordLike: true },
    ]);
  });

  it("segments Lao text the same trigram way", () => {
    expect(segmentSeaTrigram("ສະບາຍດີ")).toEqual([
      { text: "ສະບ", isWordLike: true },
      { text: "ະບາ", isWordLike: true },
      { text: "ບາຍ", isWordLike: true },
      { text: "າຍດ", isWordLike: true },
      { text: "ຍດີ", isWordLike: true },
    ]);
  });

  it("indexes a run shorter than 3 characters as one whole span, not dropped", () => {
    expect(segmentSeaTrigram("กิ")).toEqual([{ text: "กิ", isWordLike: true }]);
    expect(segmentSeaTrigram("ก")).toEqual([{ text: "ก", isWordLike: true }]);
  });

  it("segments a non-script run normally (Latin words stay whole, whitespace is not word-like)", () => {
    const spans = segmentSeaTrigram("สวัสดี hello");
    expect(spans).toEqual([
      { text: "สวั", isWordLike: true },
      { text: "วัส", isWordLike: true },
      { text: "ัสด", isWordLike: true },
      { text: "สดี", isWordLike: true },
      { text: " ", isWordLike: false },
      { text: "hello", isWordLike: true },
    ]);
  });

  it("is stable across repeated calls (index/query parity)", () => {
    const a = segmentSeaTrigram("สวัสดีครับ");
    const b = segmentSeaTrigram("สวัสดีครับ");
    expect(a).toEqual(b);
  });

  it("returns an empty array for an empty string", () => {
    expect(segmentSeaTrigram("")).toEqual([]);
  });
});
