import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GOVUK_DOMAIN_QUERY_TOPICS } from "../src/domain-schema.js";
import { hashSnapshotContent } from "../src/govuk-normalize.js";
import { GOVUK_EXPECTED_ROUTES } from "../src/govuk-refresh.js";
import { loadDomainSuite } from "../src/load-domain-suite.js";

const domainFixtureDirectory = fileURLToPath(
  new URL("../fixtures/domains/", import.meta.url),
);

const exactProvenance = {
  publisher: "Government Digital Service and GOV.UK publishing organisations",
  sourceTitle: "Learn to drive a car: step by step",
  sourceUrl: "https://www.gov.uk/learn-to-drive-a-car",
  license: "Open Government Licence v3.0",
  licenseUrl:
    "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
  retrievedAt: "2026-07-13",
  attribution:
    "Contains public sector information licensed under the Open Government Licence v3.0.",
  selectionNotes:
    "The journey hub and its 21 internal GOV.UK destinations are included. The external theory-test application and neighboring pages are excluded. Searchable text is normalized from the GOV.UK Content API.",
};

describe("committed GOV.UK driving relevance fixture", () => {
  it("is an exact, reviewable draft of the approved journey", async () => {
    const suite = await loadDomainSuite(
      domainFixtureDirectory,
      "govuk-learn-to-drive" as never,
    );
    expect(suite.id).toBe("govuk-learn-to-drive");
    expect(suite.version).toBe("1.0.0");
    expect(suite.corpus.kind).toBe("snapshot");
    if (suite.corpus.kind !== "snapshot") throw new Error("unreachable");
    expect(suite.corpus.documents).toHaveLength(22);
    expect(suite.queries).toHaveLength(20);

    const wordCounts = suite.queries.map(
      (query) => query.text.trim().split(/\s+/u).length,
    );
    expect(wordCounts.filter((count) => count >= 2 && count <= 5)).toHaveLength(
      16,
    );
    expect(wordCounts.filter((count) => count >= 6)).toHaveLength(4);
    expect(new Set(suite.queries.map((query) => query.topic))).toEqual(
      new Set(GOVUK_DOMAIN_QUERY_TOPICS),
    );
    expect(suite.review).toEqual({
      status: "reviewed",
      method:
        "Maintainer review of every normalized document, query, grade, rationale, and measured top-five result.",
      reviewer: "ktjn",
      reviewedAt: "2026-07-14",
    });
    expect(suite.corpus.documents.map((document) => document.id)).toEqual(
      GOVUK_EXPECTED_ROUTES,
    );
    expect(suite.provenance).toEqual(exactProvenance);

    for (const document of suite.corpus.documents) {
      expect(document.url).toBe(`https://www.gov.uk${document.id}`);
      expect(document.body.trim()).not.toBe("");
      expect(document.contentHash).toBe(hashSnapshotContent(document));
    }

    const positivelyJudgedIds = new Set(
      suite.queries.flatMap((query) =>
        Object.entries(query.judgments)
          .filter(([, grade]) => grade >= 1)
          .map(([id]) => id),
      ),
    );
    expect(positivelyJudgedIds).toEqual(new Set(GOVUK_EXPECTED_ROUTES));
  });
});
