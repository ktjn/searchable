import type { RangeFilter } from "@ktjn/searchable";
import { validateSuite } from "./load-suites.js";
import { evaluateRanking, type RankingMetrics } from "./metrics.js";
import type {
  RelevanceGrade,
  RelevanceSuite,
  SuiteProvenance,
  SupportedBaselineLanguage,
} from "./schema.js";

export type SearchForEvaluation = (
  query: string,
  options: {
    language: SupportedBaselineLanguage;
    limit: number;
    filters?: Record<string, string | string[] | RangeFilter>;
  },
) => Promise<readonly string[]>;

export interface QueryReport extends RankingMetrics {
  id: string;
  text: string;
  judgments: Record<string, RelevanceGrade>;
  returnedIds: string[];
}

export interface SuiteReport {
  suiteId: string;
  suiteVersion: string;
  language: SupportedBaselineLanguage;
  k: number;
  documentCount: number;
  queryCount: number;
  provenance: SuiteProvenance;
  metrics: {
    meanReciprocalRank: number;
    meanPrecisionAtK: number;
    meanRecallAtK: number;
    meanNdcgAtK: number;
    zeroResultRate: number;
  };
  queries: QueryReport[];
}

export async function evaluateSuite(
  suite: RelevanceSuite,
  search: SearchForEvaluation,
  k = 5,
): Promise<SuiteReport> {
  validateSuite(suite);
  if (!Number.isInteger(k) || k <= 0)
    throw new Error("k must be a positive integer");
  const queries: QueryReport[] = [];
  for (const query of [...suite.queries].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    let returnedIds: readonly string[];
    try {
      returnedIds = await search(query.text, {
        language: suite.language,
        limit: k,
        ...(query.filters ? { filters: query.filters } : {}),
      });
    } catch (cause) {
      throw new Error(
        `Relevance search failed for language ${suite.language}, query ${query.id}`,
        { cause },
      );
    }
    queries.push({
      id: query.id,
      text: query.text,
      judgments: query.judgments,
      returnedIds: [...returnedIds],
      ...evaluateRanking(returnedIds, query.judgments, k),
    });
  }
  const mean = (pick: (query: QueryReport) => number) =>
    queries.reduce((sum, query) => sum + pick(query), 0) / queries.length;
  return {
    suiteId: suite.id,
    suiteVersion: suite.version,
    language: suite.language,
    k,
    documentCount: suite.documents.length,
    queryCount: queries.length,
    provenance: suite.provenance,
    metrics: {
      meanReciprocalRank: mean((query) => query.reciprocalRank),
      meanPrecisionAtK: mean((query) => query.precisionAtK),
      meanRecallAtK: mean((query) => query.recallAtK),
      meanNdcgAtK: mean((query) => query.ndcgAtK),
      zeroResultRate: mean((query) => (query.zeroResult ? 1 : 0)),
    },
    queries,
  };
}
