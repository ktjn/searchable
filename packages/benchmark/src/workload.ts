import { createHash } from "node:crypto";
import type { SearchResult } from "@ktjn/searchable-client";
import { generateCms2kCorpus } from "@ktjn/searchable-fixtures";
import { canonicalize } from "@ktjn/searchable-format";
import type {
  BenchmarkConfig,
  BenchmarkQuery,
  BenchmarkWorkload,
} from "./types.js";

export const BENCHMARK_QUERIES: readonly BenchmarkQuery[] = [
  {
    id: "single-term",
    query: "benchmark",
    options: { limit: 10 },
    expected: {
      topUrl: "/en/engineering/engineering-scaling-regression-testing-7.html",
      totalHits: 125,
    },
  },
  {
    id: "multi-term",
    query: "static shard hosting",
    options: { limit: 10 },
    expected: {
      topUrl:
        "/en/guides/guides-how-to-configure-progressive-feature-adoption-10.html",
      totalHits: 125,
    },
  },
  {
    id: "prefix",
    query: "bench*",
    options: { limit: 10 },
    expected: {
      topUrl: "/en/engineering/engineering-scaling-regression-testing-7.html",
      totalHits: 125,
    },
  },
  {
    id: "no-match",
    query: "zzzz-no-match",
    options: { limit: 10 },
    expected: { totalHits: 0 },
  },
  {
    id: "filtered",
    query: "search",
    options: { limit: 10, filters: { category: "Engineering" } },
    expected: {
      topUrl: "/en/engineering/engineering-scaling-regression-testing-7.html",
      totalHits: 250,
    },
  },
  {
    id: "faceted",
    query: "search",
    options: { limit: 10, facets: ["category"] },
    expected: {
      topUrl:
        "/en/product/product-a-closer-look-at-opt-in-search-features-20.html",
      totalHits: 627,
      facetValues: [
        { value: "Company", count: 125, selected: false },
        { value: "Engineering", count: 250, selected: false },
        { value: "Guides", count: 125, selected: false },
        { value: "Product", count: 125, selected: false },
      ],
    },
  },
];

const SMOKE_TOTAL_HITS: Record<string, number> = {
  "single-term": 3,
  "multi-term": 3,
  prefix: 3,
  "no-match": 0,
  filtered: 5,
  faceted: 15,
};

const SMOKE_CATEGORY_FACETS = [
  { value: "Company", count: 3, selected: false },
  { value: "Engineering", count: 5, selected: false },
  { value: "Guides", count: 3, selected: false },
  { value: "Product", count: 2, selected: false },
];

export function hashCanonical(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

function queriesForProfile(config: BenchmarkConfig): BenchmarkQuery[] {
  if (config.profile === "cms-2k") {
    return structuredClone(BENCHMARK_QUERIES) as BenchmarkQuery[];
  }

  return BENCHMARK_QUERIES.map((query) => {
    const totalHits = SMOKE_TOTAL_HITS[query.id];
    if (totalHits === undefined) {
      throw new Error(`missing smoke expectation for ${query.id}`);
    }
    return {
      ...structuredClone(query),
      expected: {
        ...structuredClone(query.expected),
        totalHits,
        ...(query.id === "faceted"
          ? { facetValues: structuredClone(SMOKE_CATEGORY_FACETS) }
          : {}),
      },
    };
  });
}

export function createWorkload(config: BenchmarkConfig): BenchmarkWorkload {
  const documents = generateCms2kCorpus({ count: config.documentCount });
  const languageCounts: Record<string, number> = {};

  for (const document of documents) {
    const language = /<html\s+[^>]*lang=["']([^"']+)["']/i.exec(
      document.html,
    )?.[1];
    if (!language) {
      throw new Error(`document ${document.url} lacks an html lang attribute`);
    }
    languageCounts[language] = (languageCounts[language] ?? 0) + 1;
  }

  const queries = queriesForProfile(config);
  return {
    documents,
    corpusHash: hashCanonical(
      documents.map(({ id, url, html }) => [id, url, html]),
    ),
    querySetHash: hashCanonical(queries),
    queries,
    languageCounts,
  };
}

export function assertExpectedResult(
  query: BenchmarkQuery,
  result: SearchResult,
): void {
  const failure = (detail: string): never => {
    throw new Error(`${query.id}: ${detail}`);
  };

  if (result.totalHits !== query.expected.totalHits) {
    failure(
      `expected ${query.expected.totalHits} total hits, received ${result.totalHits}`,
    );
  }
  if (
    query.expected.topUrl !== undefined &&
    result.hits[0]?.url !== query.expected.topUrl
  ) {
    failure(
      `expected top URL ${query.expected.topUrl}, received ${result.hits[0]?.url ?? "none"}`,
    );
  }
  if (query.expected.facetValues !== undefined) {
    const actual = result.facets?.category?.values;
    if (JSON.stringify(actual) !== JSON.stringify(query.expected.facetValues)) {
      failure("category facet values did not match the fixed expectation");
    }
  }
}
