import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DE_FAHRERLAUBNISRECHT_DOMAIN_QUERY_TOPICS } from "../src/domain-schema.js";
import { loadDomainSuite } from "../src/load-domain-suite.js";
import { assertSnapshotSuitePolicy } from "./snapshot-suite-policy.js";

const domainFixtureDirectory = fileURLToPath(
  new URL("../fixtures/domains/", import.meta.url),
);

describe("committed German domain relevance fixture", () => {
  it("is a well-formed draft with full judgment coverage", async () => {
    const suite = await loadDomainSuite(
      domainFixtureDirectory,
      "de-fahrerlaubnisrecht",
    );
    expect(suite.id).toBe("de-fahrerlaubnisrecht");
    assertSnapshotSuitePolicy(suite, {
      language: "de",
      corpusKind: "snapshot",
      minDocuments: 20,
      minQueries: 15,
      topics: DE_FAHRERLAUBNISRECHT_DOMAIN_QUERY_TOPICS,
    });
  });
});
