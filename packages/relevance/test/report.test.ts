import { expect, it } from "vitest";
import type { SuiteReport } from "../src/evaluate.js";
import { renderConsoleReport, serializeJsonReport } from "../src/report.js";

const report: SuiteReport = {
  suiteId: "en-suite",
  suiteVersion: "1.0.0",
  language: "en",
  k: 5,
  documentCount: 8,
  queryCount: 8,
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
  metrics: {
    meanReciprocalRank: 1,
    meanPrecisionAtK: 0.2,
    meanRecallAtK: 1,
    meanNdcgAtK: 1,
    zeroResultRate: 0,
  },
  queries: [],
};

it("renders a readable summary", () => {
  expect(renderConsoleReport([report])).toContain("en  en-suite@1.0.0");
  expect(renderConsoleReport([report])).toContain("MRR 1.000000");
});

it("serializes deterministic machine-readable JSON", () => {
  const json = serializeJsonReport([report], 5);
  expect(json).toBe(serializeJsonReport([report], 5));
  expect(JSON.parse(json)).toMatchObject({ schemaVersion: 1, k: 5 });
  expect(json).not.toMatch(/generated|timestamp|tookMs/);
});
