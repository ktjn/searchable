import type { Manifest, Posting } from "@csf/format";
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
  docCount: 100,
  avgFieldLength: { title: 5, body: 200 },
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
    expect(scoreTermForDoc(titleMatch, df, manifest)).toBeGreaterThan(
      scoreTermForDoc(bodyMatch, df, manifest),
    );
  });

  it("gives a higher score to a rarer term (lower df)", () => {
    const posting: Posting = {
      doc: 1,
      fields: { body: { tf: 1, pos: [0], len: 200 } },
    };
    expect(scoreTermForDoc(posting, 2, manifest)).toBeGreaterThan(
      scoreTermForDoc(posting, 50, manifest),
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
    expect(scoreTermForDoc(shortField, 10, manifest)).toBeGreaterThan(
      scoreTermForDoc(longField, 10, manifest),
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
    expect(scoreTermForDoc(multiField, 10, manifest)).toBeGreaterThan(
      scoreTermForDoc(titleOnly, 10, manifest),
    );
  });
});
