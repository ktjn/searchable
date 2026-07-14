import { describe, expect, it } from "vitest";
import { validateDomainSuite } from "../src/validate-domain-suite.js";

const validDomainSuite = {
  schemaVersion: 2,
  id: "searchable-docs",
  version: "1.0.0",
  language: "en",
  provenance: {
    publisher: "Searchable contributors",
    sourceTitle: "Searchable documentation",
    sourceUrl: "https://ktjn.github.io/searchable/",
    license: "MIT",
    licenseUrl: "https://github.com/ktjn/searchable/blob/main/LICENSE",
    retrievedAt: "2026-07-13",
    attribution: "Searchable contributors",
    selectionNotes: "All generated documentation pages are included.",
  },
  review: {
    status: "draft",
    method: "Maintainer review of every query, grade, rationale, and result.",
  },
  corpus: {
    kind: "generated-index",
    pages: [
      { id: "/index.html", title: "Searchable" },
      { id: "/docs/guides/offline-search.html", title: "Offline search" },
    ],
  },
  queries: [
    {
      id: "offline-caching",
      text: "keep search working without a network",
      topic: "offline-worker",
      judgments: { "/docs/guides/offline-search.html": 3 },
      rationales: {
        "/docs/guides/offline-search.html":
          "Explains Service Worker registration and index precaching for offline use.",
      },
    },
  ],
};

// biome-ignore lint/suspicious/noExplicitAny: validation tests deliberately mutate malformed unknown input shapes.
type MutableSuite = Record<string, any>;

function copy(): MutableSuite {
  return structuredClone(validDomainSuite);
}

function snapshotCopy(): MutableSuite {
  const suite = copy();
  suite.corpus = {
    kind: "snapshot",
    documents: [
      {
        id: "/learn",
        url: "https://www.gov.uk/learn",
        title: "Learn to drive a car",
        description: "The steps needed to learn to drive.",
        body: "Apply for a provisional licence and prepare for your tests.",
        contentHash: "a".repeat(64),
      },
    ],
  };
  suite.queries[0].judgments = { "/learn": 3 };
  suite.queries[0].rationales = { "/learn": "Directly answers the query." };
  return suite;
}

describe("validateDomainSuite", () => {
  it("accepts a valid draft suite", () => {
    expect(validateDomainSuite(copy())).toEqual(validDomainSuite);
  });

  it("accepts a valid snapshot suite", () => {
    const suite = snapshotCopy();
    expect(validateDomainSuite(suite)).toEqual(suite);
  });

  it.each([
    "eligibility-eyesight",
    "provisional-licence",
    "lessons-practice",
    "theory-preparation",
    "theory-test-management",
    "practical-test-management",
    "after-passing",
  ])("accepts the GOV.UK topic %s", (topic) => {
    const suite = copy();
    suite.queries[0].topic = topic;
    expect(validateDomainSuite(suite).queries[0].topic).toBe(topic);
  });

  it.each([
    [
      "duplicate page IDs",
      (suite: MutableSuite) =>
        suite.corpus.pages.push({ ...suite.corpus.pages[0] }),
      /duplicate page id \/index\.html/,
    ],
    [
      "duplicate query IDs",
      (suite: MutableSuite) => suite.queries.push({ ...suite.queries[0] }),
      /duplicate query id offline-caching/,
    ],
    [
      "unsupported language",
      (suite: MutableSuite) => {
        suite.language = "fr";
      },
      /language is not a supported baseline language/,
    ],
    [
      "unknown topic",
      (suite: MutableSuite) => {
        suite.queries[0].topic = "unknown";
      },
      /topic is not supported/,
    ],
    [
      "unknown judged page",
      (suite: MutableSuite) => {
        suite.queries[0].judgments = { "/missing.html": 3 };
        suite.queries[0].rationales = { "/missing.html": "Direct answer." };
      },
      /judgment references unknown page \/missing\.html/,
    ],
    [
      "no positive judgment",
      (suite: MutableSuite) => {
        suite.queries[0].judgments = { "/index.html": 0 };
        suite.queries[0].rationales = {};
      },
      /must have a positive judgment/,
    ],
    [
      "positive judgment without rationale",
      (suite: MutableSuite) => {
        suite.queries[0].rationales = {};
      },
      /rationale keys must exactly match positive judgments/,
    ],
    [
      "rationale without positive judgment",
      (suite: MutableSuite) => {
        suite.queries[0].judgments = { "/index.html": 0 };
        suite.queries[0].rationales = { "/index.html": "Context." };
      },
      /rationale keys must exactly match positive judgments/,
    ],
    [
      "blank rationale",
      (suite: MutableSuite) => {
        suite.queries[0].rationales["/docs/guides/offline-search.html"] = " ";
      },
      /rationales.*must be a non-blank string/,
    ],
    [
      "malformed provenance",
      (suite: MutableSuite) => {
        suite.provenance.sourceUrl = "not a URL";
      },
      /sourceUrl must be an HTTP\(S\) URL/,
    ],
    [
      "draft review with reviewer",
      (suite: MutableSuite) => {
        suite.review.reviewer = "ktjn";
      },
      /draft review must omit reviewer and reviewedAt/,
    ],
    [
      "reviewed status without reviewer metadata",
      (suite: MutableSuite) => {
        suite.review.status = "reviewed";
      },
      /reviewer must be a non-blank string/,
    ],
  ])("rejects %s", (_name, mutate, message) => {
    const suite = copy();
    mutate(suite);
    expect(() => validateDomainSuite(suite)).toThrow(message);
  });

  it.each([
    [
      "schema version 1",
      (suite: MutableSuite) => {
        suite.schemaVersion = 1;
      },
      /schemaVersion must be 2/,
    ],
    [
      "unknown corpus kind",
      (suite: MutableSuite) => {
        suite.corpus.kind = "unknown";
      },
      /corpus.kind must be "generated-index" or "snapshot"/,
    ],
    [
      "generated corpus carrying documents",
      (suite: MutableSuite) => {
        suite.corpus.kind = "generated-index";
        suite.corpus.pages = [
          { id: "/index.html", title: "Searchable" },
          { id: "/docs/guides/offline-search.html", title: "Offline search" },
        ];
        suite.corpus.documents = [];
        suite.queries[0].judgments = {
          "/docs/guides/offline-search.html": 3,
        };
        suite.queries[0].rationales = {
          "/docs/guides/offline-search.html": "Direct answer.",
        };
      },
      /generated-index corpus must omit documents/,
    ],
    [
      "snapshot corpus carrying pages",
      (suite: MutableSuite) => {
        suite.corpus.pages = [];
      },
      /snapshot corpus must omit pages/,
    ],
    [
      "empty snapshot documents",
      (suite: MutableSuite) => {
        suite.corpus.documents = [];
      },
      /corpus.documents must be a non-empty array/,
    ],
    [
      "duplicate snapshot document IDs",
      (suite: MutableSuite) => {
        suite.corpus.documents.push({ ...suite.corpus.documents[0] });
      },
      /duplicate document id \/learn/,
    ],
    [
      "non-HTTPS snapshot URL",
      (suite: MutableSuite) => {
        suite.corpus.documents[0].url = "http://www.gov.uk/learn";
      },
      /url must be an HTTPS URL/,
    ],
    [
      "snapshot URL pathname and ID mismatch",
      (suite: MutableSuite) => {
        suite.corpus.documents[0].url = "https://www.gov.uk/learn-to-drive";
      },
      /URL pathname must equal document id \/learn/,
    ],
    ...(["title", "description", "body"] as const).map((field) => [
      `blank snapshot ${field}`,
      (suite: MutableSuite) => {
        suite.corpus.documents[0][field] = " ";
      },
      new RegExp(`${field} must be a non-blank string`),
    ]),
    [
      "malformed snapshot content hash",
      (suite: MutableSuite) => {
        suite.corpus.documents[0].contentHash = "ABC";
      },
      /contentHash must be a lowercase SHA-256 hash/,
    ],
    [
      "judgment outside the active snapshot corpus",
      (suite: MutableSuite) => {
        suite.queries[0].judgments = { "/index.html": 3 };
        suite.queries[0].rationales = { "/index.html": "Direct answer." };
      },
      /judgment references unknown document \/index\.html/,
    ],
  ])("rejects %s", (_name, mutate, message) => {
    const suite = snapshotCopy();
    mutate(suite);
    expect(() => validateDomainSuite(suite)).toThrow(message);
  });

  it("accepts complete reviewed metadata", () => {
    const suite = copy();
    suite.review = {
      status: "reviewed",
      method: suite.review.method,
      reviewer: "ktjn",
      reviewedAt: "2026-07-13",
    };
    expect(validateDomainSuite(suite).review).toEqual(suite.review);
  });
});
