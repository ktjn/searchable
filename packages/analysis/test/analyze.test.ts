import { describe, expect, it } from "vitest";
import {
  analyze,
  chinese,
  dutch,
  english,
  japanese,
  khmer,
  lao,
  norwegianBokmal,
  swedish,
  thai,
} from "../src/index.js";

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

  it("stems English tokens via the classic Porter algorithm, but does not drop stopwords (empty list)", () => {
    const tokens = analyze("the running dogs", english);
    expect(tokens.map((t) => t.term)).toEqual(["the", "run", "dog"]);
  });

  it("also exposes each token's lowercased-but-unstemmed literal surface form", () => {
    const tokens = analyze("the running dogs", english);
    expect(tokens.map((t) => t.literal)).toEqual(["the", "running", "dogs"]);
  });
});

describe("analyze (Swedish, Norwegian, and Dutch)", () => {
  it("uses each language's Snowball stemmer", () => {
    expect(analyze("husets", swedish)[0]?.term).toBe("hus");
    expect(analyze("husets", norwegianBokmal)[0]?.term).toBe("hus");
    expect(analyze("huizen", dutch)[0]?.term).toBe("huis");
  });
});

describe("analyze (chinese/japanese, bigram fallback segmentation)", () => {
  it("produces overlapping bigrams as terms, unstemmed (stem is identity)", () => {
    const tokens = analyze("自然語言處理", chinese);
    expect(tokens.map((t) => t.term)).toEqual([
      "自然",
      "然語",
      "語言",
      "言處",
      "處理",
    ]);
    expect(tokens.map((t) => t.literal)).toEqual(tokens.map((t) => t.term));
  });

  it("assigns sequential positions to bigram tokens, same as word tokens for other languages", () => {
    const tokens = analyze("自然語言", chinese);
    expect(tokens.map((t) => t.position)).toEqual([0, 1, 2]);
  });

  it("segments hiragana/katakana Japanese text the same bigram way", () => {
    const tokens = analyze("こんにちは", japanese);
    expect(tokens.map((t) => t.term)).toEqual(["こん", "んに", "にち", "ちは"]);
  });

  it("is stable across repeated calls (index/query parity)", () => {
    const a = analyze("深度學習模型", chinese);
    const b = analyze("深度學習模型", chinese);
    expect(a).toEqual(b);
  });

  it("mixes CJK bigrams and whole Latin words in one token stream", () => {
    const tokens = analyze("深度learning模型", chinese);
    expect(tokens.map((t) => t.term)).toEqual(["深度", "learning", "模型"]);
  });
});

describe("analyze (thai/khmer/lao, trigram fallback segmentation)", () => {
  it("produces overlapping trigrams as terms, unstemmed (stem is identity)", () => {
    const tokens = analyze("สวัสดี", thai);
    expect(tokens.map((t) => t.term)).toEqual(["สวั", "วัส", "ัสด", "สดี"]);
    expect(tokens.map((t) => t.literal)).toEqual(tokens.map((t) => t.term));
  });

  it("segments Khmer text the same trigram way", () => {
    const tokens = analyze("សួស្តី", khmer);
    expect(tokens.map((t) => t.term)).toEqual(["សួស", "ួស្", "ស្ត", "្តី"]);
  });

  it("segments Lao text the same trigram way", () => {
    const tokens = analyze("ສະບາຍດີ", lao);
    expect(tokens.map((t) => t.term)).toEqual([
      "ສະບ",
      "ະບາ",
      "ບາຍ",
      "າຍດ",
      "ຍດີ",
    ]);
  });

  it("assigns sequential positions to trigram tokens, same as word tokens for other languages", () => {
    const tokens = analyze("สวัสดี", thai);
    expect(tokens.map((t) => t.position)).toEqual([0, 1, 2, 3]);
  });

  it("is stable across repeated calls (index/query parity)", () => {
    const a = analyze("สวัสดีครับ", thai);
    const b = analyze("สวัสดีครับ", thai);
    expect(a).toEqual(b);
  });

  it("mixes Thai trigrams and whole Latin words in one token stream", () => {
    const tokens = analyze("สวัสดี hello", thai);
    expect(tokens.map((t) => t.term)).toEqual([
      "สวั",
      "วัส",
      "ัสด",
      "สดี",
      "hello",
    ]);
  });
});
