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
