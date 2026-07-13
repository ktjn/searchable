import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DOC_SECTIONS } from "../../../showcase/docs-nav.js";
import { DOMAIN_QUERY_TOPICS } from "../src/domain-schema.js";
import { loadDomainSuite } from "../src/load-domain-suite.js";

const domainFixtureDirectory = fileURLToPath(
  new URL("../fixtures/domains/", import.meta.url),
);
const expectedPages = [
  ...DOC_SECTIONS.flatMap((section) =>
    section.pages.map((page) => ({
      id: `/${page.route}.html`,
      title: page.title,
    })),
  ),
  { id: "/index.html", title: "Searchable" },
].sort((left, right) => left.id.localeCompare(right.id));

describe("committed documentation relevance fixture", () => {
  it("is a representative, reviewable draft of the generated site", async () => {
    const suite = await loadDomainSuite(
      domainFixtureDirectory,
      "searchable-docs",
    );
    expect(suite.id).toBe("searchable-docs");
    expect(suite.corpus.kind).toBe("generated-index");
    if (suite.corpus.kind !== "generated-index") throw new Error("unreachable");
    expect(suite.corpus.pages).toHaveLength(28);
    expect(suite.queries).toHaveLength(20);
    expect(new Set(suite.queries.map((query) => query.topic))).toEqual(
      new Set(DOMAIN_QUERY_TOPICS),
    );
    expect(
      suite.queries.filter(
        (query) =>
          Object.values(query.judgments).filter((grade) => grade >= 1).length >
          1,
      ).length,
    ).toBeGreaterThanOrEqual(5);
    const queryWordCounts = suite.queries.map(
      (query) => query.text.trim().split(/\s+/u).length,
    );
    expect(
      queryWordCounts.filter((count) => count >= 2 && count <= 5),
    ).toHaveLength(17);
    expect(
      queryWordCounts.filter((count) => count >= 6 && count <= 7),
    ).toHaveLength(3);
    expect(suite.review).toEqual({
      status: "reviewed",
      method:
        "Maintainer review of every query, grade, rationale, and measured top-five result.",
      reviewer: "ktjn",
      reviewedAt: "2026-07-13",
    });
    expect(suite.corpus.pages).toEqual(expectedPages);
  });
});
