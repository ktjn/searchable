import type {
  RelevanceGrade,
  SuiteProvenance,
  SupportedBaselineLanguage,
} from "./schema.js";

export const DOMAIN_QUERY_TOPICS = [
  "setup",
  "indexing-deployment",
  "lexical-features",
  "internationalization",
  "offline-worker",
  "relevance",
  "vector-hybrid",
] as const;

export type DomainQueryTopic = (typeof DOMAIN_QUERY_TOPICS)[number];

export interface DomainPage {
  id: string;
  title: string;
}

export interface DomainJudgedQuery {
  id: string;
  text: string;
  topic: DomainQueryTopic;
  judgments: Record<string, RelevanceGrade>;
  rationales: Record<string, string>;
}

export type JudgmentReview =
  | { status: "draft"; method: string }
  | {
      status: "reviewed";
      method: string;
      reviewer: string;
      reviewedAt: string;
    };

export interface DomainRelevanceSuite {
  schemaVersion: 1;
  id: string;
  version: string;
  language: SupportedBaselineLanguage;
  provenance: SuiteProvenance;
  review: JudgmentReview;
  pages: DomainPage[];
  queries: DomainJudgedQuery[];
}
