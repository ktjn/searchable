import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DE_FAHRERLAUBNISRECHT_DOMAIN_QUERY_TOPICS } from "../src/domain-schema.js";
import { hashSnapshotContent } from "../src/govuk-normalize.js";
import { loadDomainSuite } from "../src/load-domain-suite.js";

const domainFixtureDirectory = fileURLToPath(
  new URL("../fixtures/domains/", import.meta.url),
);

describe("committed German domain relevance fixture", () => {
  it("is a well-formed draft with full judgment coverage", async () => {
    const suite = await loadDomainSuite(
      domainFixtureDirectory,
      "de-fahrerlaubnisrecht" as never,
    );
    expect(suite.id).toBe("de-fahrerlaubnisrecht");
    expect(suite.language).toBe("de");
    expect(suite.corpus.kind).toBe("snapshot");
    if (suite.corpus.kind !== "snapshot") throw new Error("unreachable");
    expect(suite.corpus.documents.length).toBeGreaterThanOrEqual(20);
    expect(suite.queries.length).toBeGreaterThanOrEqual(15);

    expect(new Set(suite.queries.map((query) => query.topic))).toEqual(
      new Set(DE_FAHRERLAUBNISRECHT_DOMAIN_QUERY_TOPICS),
    );

    for (const document of suite.corpus.documents) {
      expect(document.body.trim()).not.toBe("");
      expect(document.contentHash).toBe(hashSnapshotContent(document));
    }

    for (const query of suite.queries) {
      const positiveIds = Object.entries(query.judgments)
        .filter(([, grade]) => grade >= 1)
        .map(([id]) => id);
      expect(positiveIds.length).toBeGreaterThan(0);
      expect(Object.keys(query.rationales).sort()).toEqual(
        [...positiveIds].sort(),
      );
    }
  });
});
