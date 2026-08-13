import { describe, expect, it } from "vitest";
import { evaluateSuite } from "../src/evaluate.js";
import type { RelevanceSuite } from "../src/schema.js";

const suite: RelevanceSuite = {
  schemaVersion: 1,
  id: "en-evaluator-v1",
  version: "1.0.0",
  language: "en",
  provenance: {
    publisher: "Example",
    sourceTitle: "Help",
    sourceUrl: "https://example.test/help",
    license: "CC-BY-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    retrievedAt: "2026-07-13",
    attribution: "Example",
    selectionNotes: "Verbatim help pairs.",
  },
  documents: [
    {
      id: "answer-1",
      title: "One",
      body: "First answer",
      url: "https://example.test/1",
    },
    {
      id: "answer-2",
      title: "Two",
      body: "Second answer",
      url: "https://example.test/2",
    },
  ],
  queries: [
    { id: "question-b", text: "missing", judgments: { "answer-2": 3 } },
    { id: "question-a", text: "first", judgments: { "answer-1": 3 } },
  ],
};

describe("evaluateSuite", () => {
  it("evaluates queries in stable order and averages their metrics", async () => {
    const report = await evaluateSuite(
      suite,
      async (query) => (query === "first" ? ["answer-1"] : []),
      5,
    );

    expect(report.queries.map((query) => query.id)).toEqual([
      "question-a",
      "question-b",
    ]);
    expect(report.queries[0]?.returnedIds).toEqual(["answer-1"]);
    expect(report.queryCount).toBe(2);
    expect(report.documentCount).toBe(2);
    expect(report.metrics).toMatchObject({
      meanReciprocalRank: 0.5,
      zeroResultRate: 0.5,
    });
    expect(report.provenance).toEqual(suite.provenance);
  });

  it("adds suite and query context while preserving the cause", async () => {
    const cause = new Error("search exploded");
    await expect(
      evaluateSuite(suite, async () => {
        throw cause;
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/en.*question-a/),
      cause,
    });
  });
});
