import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadSuites } from "../src/load-suites.js";
import { SUPPORTED_BASELINE_LANGUAGES } from "../src/schema.js";

const fixtureDirectory = fileURLToPath(
  new URL("../fixtures/", import.meta.url),
);

describe("committed relevance fixtures", () => {
  it("cover every full language profile with native-source provenance", async () => {
    const suites = await loadSuites(fixtureDirectory);
    expect(suites.map((suite) => suite.language)).toEqual(
      SUPPORTED_BASELINE_LANGUAGES,
    );
    expect(new Set(suites.map((suite) => suite.id)).size).toBe(suites.length);
    for (const suite of suites) {
      expect(suite.id).toMatch(new RegExp(`^${suite.language}-`));
      expect(suite.documents.length).toBeGreaterThanOrEqual(8);
      expect(suite.queries.length).toBeGreaterThanOrEqual(8);
      expect(suite.provenance.sourceUrl).not.toBe(suite.provenance.licenseUrl);
      expect(suite.provenance.selectionNotes).toMatch(/verbatim|native/i);
      for (const query of suite.queries)
        expect(Object.values(query.judgments).some((grade) => grade >= 1)).toBe(
          true,
        );
    }
  });
});
