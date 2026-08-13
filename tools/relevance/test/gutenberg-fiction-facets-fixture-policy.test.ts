import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GUTENBERG_FICTION_FACETS_DOMAIN_QUERY_TOPICS } from "../src/domain-schema.js";
import { loadDomainSuite } from "../src/load-domain-suite.js";
import { assertSnapshotSuitePolicy } from "./snapshot-suite-policy.js";

const domainFixtureDirectory = fileURLToPath(
  new URL("../fixtures/domains/", import.meta.url),
);

describe("committed Gutenberg facets domain relevance fixture", () => {
  it("is a well-formed draft with full judgment coverage and consistent filters", async () => {
    const suite = await loadDomainSuite(
      domainFixtureDirectory,
      "gutenberg-fiction-facets",
    );
    expect(suite.id).toBe("gutenberg-fiction-facets");
    assertSnapshotSuitePolicy(suite, {
      language: "en",
      corpusKind: "snapshot",
      minDocuments: 30,
      minQueries: 20,
      topics: GUTENBERG_FICTION_FACETS_DOMAIN_QUERY_TOPICS,
    });

    // Filter queries must judge documents that actually satisfy the
    // stated filter (facets.md): every positively judged id under a
    // range filter must declare that range facet and fall in [min, max];
    // every positively judged id under a terms/value filter must carry
    // at least one of the requested values.
    if (suite.corpus.kind !== "snapshot") throw new Error("unreachable");
    const filterQueries = suite.queries.filter((query) => query.filters);
    expect(filterQueries.length).toBeGreaterThanOrEqual(7);
    for (const query of filterQueries) {
      const positiveIds = Object.entries(query.judgments)
        .filter(([, grade]) => grade >= 1)
        .map(([id]) => id);
      for (const id of positiveIds) {
        const document = suite.corpus.documents.find((d) => d.id === id);
        if (!document) throw new Error(`unknown document ${id}`);
        for (const [field, filterValue] of Object.entries(
          query.filters ?? {},
        )) {
          if (typeof filterValue === "object" && !Array.isArray(filterValue)) {
            const actual = document.rangeFacets?.[field];
            if (actual === undefined)
              throw new Error(
                `query ${query.id} judges ${id} under range filter ${field} but the document declares no such rangeFacet`,
              );
            if (filterValue.min !== undefined)
              expect(actual).toBeGreaterThanOrEqual(filterValue.min);
            if (filterValue.max !== undefined)
              expect(actual).toBeLessThanOrEqual(filterValue.max);
          } else {
            const wanted = Array.isArray(filterValue)
              ? filterValue
              : [filterValue];
            const actual = document.facets?.[field] ?? [];
            expect(wanted.some((value) => actual.includes(value))).toBe(true);
          }
        }
      }
    }
  });
});
