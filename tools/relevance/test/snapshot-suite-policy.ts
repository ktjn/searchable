import { expect } from "vitest";
import type { DomainRelevanceSuite } from "../src/domain-schema.js";
import { hashSnapshotContent } from "../src/snapshot-hash.js";

/**
 * Shared policy assertions every committed *snapshot* domain relevance
 * fixture must satisfy (de-fahrerlaubnisrecht, gutenberg-fiction-facets
 * — and any future snapshot suite). Each suite's dedicated policy test
 * still pins its own id/language/topic set and minimum sizes, then calls
 * this to assert the common shape: every document has non-empty body text
 * and a content hash that matches a fresh recomputation, and every query
 * carries at least one positive judgment whose rationale keys exactly
 * cover the positive-judgment ids (searchable-runner.ts#21).
 */
export function assertSnapshotSuitePolicy(
  suite: DomainRelevanceSuite,
  options: {
    language: string;
    corpusKind: "snapshot";
    minDocuments: number;
    minQueries: number;
    topics: readonly string[];
  },
): void {
  expect(suite.language).toBe(options.language);
  expect(suite.corpus.kind).toBe(options.corpusKind);
  if (suite.corpus.kind !== "snapshot") throw new Error("unreachable");
  expect(suite.corpus.documents.length).toBeGreaterThanOrEqual(
    options.minDocuments,
  );
  expect(suite.queries.length).toBeGreaterThanOrEqual(options.minQueries);

  expect(new Set(suite.queries.map((query) => query.topic))).toEqual(
    new Set(options.topics),
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
}
