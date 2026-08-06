import { describe, expect, it } from "vitest";
import { validateSuite } from "../src/load-suites.js";

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
    selectionNotes:
      "Questions and corresponding answers were selected verbatim.",
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

type MutableSuite = {
  language: string;
  provenance: {
    publisher: string;
    retrievedAt: string;
    sourceUrl: string;
  };
  documents: Array<{ id: string; title: string; body: string; url: string }>;
  queries: Array<{
    id: string;
    text: string;
    judgments: Record<string, number>;
  }>;
};

function changed(mutator: (suite: MutableSuite) => void): unknown {
  const suite = structuredClone(validSuite);
  mutator(suite);
  return suite;
}

describe("validateSuite", () => {
  it("returns a complete valid suite", () => {
    expect(validateSuite(validSuite)).toEqual(validSuite);
  });

  it.each([
    [
      "unsupported language",
      (s: MutableSuite) => (s.language = "fr"),
      /language/,
    ],
    [
      "blank provenance",
      (s: MutableSuite) => (s.provenance.publisher = " "),
      /publisher/,
    ],
    [
      "bad date",
      (s: MutableSuite) => (s.provenance.retrievedAt = "2026-02-30"),
      /retrievedAt/,
    ],
    [
      "bad URL",
      (s: MutableSuite) => (s.provenance.sourceUrl = "file:///tmp/help"),
      /sourceUrl/,
    ],
    [
      "duplicate document",
      (s: MutableSuite) => s.documents.push(s.documents[0]),
      /duplicate document/,
    ],
    [
      "duplicate query",
      (s: MutableSuite) => s.queries.push(s.queries[0]),
      /duplicate query/,
    ],
    ["empty body", (s: MutableSuite) => (s.documents[0].body = ""), /body/],
    [
      "unknown judgment",
      (s: MutableSuite) => (s.queries[0].judgments = { missing: 3 }),
      /unknown document/,
    ],
    [
      "invalid grade",
      (s: MutableSuite) => (s.queries[0].judgments["answer-1"] = 4),
      /grade/,
    ],
    [
      "no positive judgment",
      (s: MutableSuite) => (s.queries[0].judgments["answer-1"] = 0),
      /positive judgment/,
    ],
  ])("rejects %s", (_name, mutate, message) => {
    expect(() => validateSuite(changed(mutate))).toThrow(message);
  });
});
