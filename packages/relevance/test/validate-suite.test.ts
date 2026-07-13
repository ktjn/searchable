import { describe, expect, it } from "vitest";
import { validateSuite } from "../src/validate-suite.js";

const validSuite = {
  schemaVersion: 1,
  id: "en-native-help-v1",
  version: "1.0.0",
  language: "en",
  provenance: {
    publisher: "Example public body",
    sourceTitle: "Help",
    sourceUrl: "https://example.test/help",
    license: "CC-BY-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    retrievedAt: "2026-07-13",
    attribution: "Example public body",
    selectionNotes: "Questions and corresponding answers were selected verbatim.",
  },
  documents: [
    {
      id: "answer-1",
      title: "Answer one",
      body: "Native answer text.",
      url: "https://example.test/help#one",
    },
  ],
  queries: [
    {
      id: "question-1",
      text: "Native question?",
      judgments: { "answer-1": 3 },
    },
  ],
};

function changed(mutator: (suite: any) => void): unknown {
  const suite = structuredClone(validSuite);
  mutator(suite);
  return suite;
}

describe("validateSuite", () => {
  it("returns a complete valid suite", () => {
    expect(validateSuite(validSuite)).toEqual(validSuite);
  });

  it.each([
    ["unsupported language", (s: any) => (s.language = "fr"), /language/],
    ["blank provenance", (s: any) => (s.provenance.publisher = " "), /publisher/],
    ["bad date", (s: any) => (s.provenance.retrievedAt = "2026-02-30"), /retrievedAt/],
    ["bad URL", (s: any) => (s.provenance.sourceUrl = "file:///tmp/help"), /sourceUrl/],
    ["duplicate document", (s: any) => s.documents.push(s.documents[0]), /duplicate document/],
    ["duplicate query", (s: any) => s.queries.push(s.queries[0]), /duplicate query/],
    ["empty body", (s: any) => (s.documents[0].body = ""), /body/],
    ["unknown judgment", (s: any) => (s.queries[0].judgments = { missing: 3 }), /unknown document/],
    ["invalid grade", (s: any) => (s.queries[0].judgments["answer-1"] = 4), /grade/],
    ["no positive judgment", (s: any) => (s.queries[0].judgments["answer-1"] = 0), /positive judgment/],
  ])("rejects %s", (_name, mutate, message) => {
    expect(() => validateSuite(changed(mutate))).toThrow(message);
  });
});
