import type { Manifest, Posting } from "@ktjn/searchable-format";
import { describe, expect, it } from "vitest";
import { scoreTermForDoc } from "../src/score.js";

const manifest: Manifest = {
  version: 1,
  buildId: "test",
  format: "json",
  languages: ["en"],
  defaultLanguage: "en",
  fields: {
    title: { boost: 3.0, stored: true },
    body: { boost: 1.0, stored: false },
  },
  docCount: { en: 100 },
  avgFieldLength: { en: { title: 5, body: 200 } },
  shards: { terms: [], docs: [] },
};

describe("scoreTermForDoc (BM25F)", () => {
  it("gives a higher score to a title match than a body match, all else equal", () => {
    const titleMatch: Posting = {
      doc: 1,
      fields: { title: { tf: 1, pos: [0], len: 5 } },
    };
    const bodyMatch: Posting = {
      doc: 2,
      fields: { body: { tf: 1, pos: [0], len: 200 } },
    };
    const df = 10;
    expect(scoreTermForDoc(titleMatch, df, manifest, "en")).toBeGreaterThan(
      scoreTermForDoc(bodyMatch, df, manifest, "en"),
    );
  });

  it("gives a higher score to a rarer term (lower df)", () => {
    const posting: Posting = {
      doc: 1,
      fields: { body: { tf: 1, pos: [0], len: 200 } },
    };
    expect(scoreTermForDoc(posting, 2, manifest, "en")).toBeGreaterThan(
      scoreTermForDoc(posting, 50, manifest, "en"),
    );
  });

  it("penalizes a field longer than the corpus average (length normalization)", () => {
    const shortField: Posting = {
      doc: 1,
      fields: { body: { tf: 1, pos: [0], len: 50 } },
    };
    const longField: Posting = {
      doc: 2,
      fields: { body: { tf: 1, pos: [0], len: 2000 } },
    };
    expect(scoreTermForDoc(shortField, 10, manifest, "en")).toBeGreaterThan(
      scoreTermForDoc(longField, 10, manifest, "en"),
    );
  });

  it("sums contributions across multiple matched fields", () => {
    const multiField: Posting = {
      doc: 1,
      fields: {
        title: { tf: 1, pos: [0], len: 5 },
        body: { tf: 1, pos: [0], len: 200 },
      },
    };
    const titleOnly: Posting = {
      doc: 2,
      fields: { title: { tf: 1, pos: [0], len: 5 } },
    };
    expect(scoreTermForDoc(multiField, 10, manifest, "en")).toBeGreaterThan(
      scoreTermForDoc(titleOnly, 10, manifest, "en"),
    );
  });

  it("lets a per-query fieldBoostOverrides win over the manifest's boost", () => {
    const bodyMatch: Posting = {
      doc: 1,
      fields: { body: { tf: 1, pos: [0], len: 200 } },
    };
    const withoutOverride = scoreTermForDoc(bodyMatch, 10, manifest, "en");
    const withOverride = scoreTermForDoc(bodyMatch, 10, manifest, "en", {
      body: 10,
    });
    expect(withOverride).toBeGreaterThan(withoutOverride);
  });

  it("falls back to the manifest boost for fields not present in the override", () => {
    const titleMatch: Posting = {
      doc: 1,
      fields: { title: { tf: 1, pos: [0], len: 5 } },
    };
    // override only affects "body"; "title" should still use manifest's 3.0
    expect(scoreTermForDoc(titleMatch, 10, manifest, "en", { body: 10 })).toBe(
      scoreTermForDoc(titleMatch, 10, manifest, "en"),
    );
  });

  it("uses the given language's own docCount/avgFieldLength, not another language's", () => {
    const multiLangManifest: Manifest = {
      ...manifest,
      languages: ["en", "de"],
      docCount: { en: 100, de: 4 },
      avgFieldLength: {
        en: { title: 5, body: 200 },
        de: { title: 2, body: 20 },
      },
    };
    const posting: Posting = {
      doc: 1,
      fields: { body: { tf: 1, pos: [0], len: 20 } },
    };
    // Same posting, scored against each language's own (very different)
    // corpus stats, must give different scores -- proving the language
    // parameter actually selects distinct stats rather than being ignored.
    expect(
      scoreTermForDoc(posting, 2, multiLangManifest, "en"),
    ).not.toBeCloseTo(scoreTermForDoc(posting, 2, multiLangManifest, "de"));
  });
});
