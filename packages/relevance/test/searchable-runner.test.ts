import { expect, it } from "vitest";
import type { RelevanceSuite } from "../src/schema.js";
import { runSearchableSuite } from "../src/searchable-runner.js";

const suite: RelevanceSuite = {
  schemaVersion: 1,
  id: "en-runner-v1",
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
      id: "password",
      title: "Reset a password",
      body: "Reset your forgotten password securely.",
      url: "https://example.test/password",
    },
    {
      id: "invoice",
      title: "Get an invoice copy",
      body: "Download a copy of an invoice from billing.",
      url: "https://example.test/invoice",
    },
    {
      id: "profile",
      title: "Edit profile",
      body: "Change your public profile details.",
      url: "https://example.test/profile",
    },
  ],
  queries: [
    { id: "invoice-copy", text: "invoice copy", judgments: { invoice: 3 } },
    {
      id: "reset-password",
      text: "reset password",
      judgments: { password: 3 },
    },
  ],
};

it("evaluates a suite through the public indexer and client APIs", async () => {
  const report = await runSearchableSuite(suite, 3);
  expect(report.queries.map((query) => query.returnedIds[0])).toEqual([
    "invoice",
    "password",
  ]);
  expect(report.metrics.meanReciprocalRank).toBe(1);
});

const facetSuite: RelevanceSuite = {
  schemaVersion: 1,
  id: "facet-test",
  version: "1.0.0",
  language: "en",
  provenance: suite.provenance,
  documents: [
    {
      id: "/a",
      url: "https://example.com/a",
      title: "Book A",
      body: "An adventure story.",
      facets: { genre: ["Adventure"] },
      rangeFacets: { year: 1850 },
    },
    {
      id: "/b",
      url: "https://example.com/b",
      title: "Book B",
      body: "A science fiction story.",
      facets: { genre: ["Science Fiction"] },
      rangeFacets: { year: 1950 },
    },
  ],
  queries: [
    {
      id: "adventure-only",
      text: "story",
      judgments: { "/a": 3, "/b": 1 },
      filters: { genre: "Adventure" },
    },
  ],
};

it("applies query filters and returns only matching documents", async () => {
  const report = await runSearchableSuite(facetSuite);
  const query = report.queries.find((q) => q.id === "adventure-only");
  expect(query?.returnedIds).toEqual(["/a"]);
});
