import type {
  RelevanceGrade,
  SuiteProvenance,
  SupportedBaselineLanguage,
} from "./schema.js";

const EXISTING_DOMAIN_QUERY_TOPICS = [
  "setup",
  "indexing-deployment",
  "lexical-features",
  "internationalization",
  "offline-worker",
  "relevance",
  "vector-hybrid",
] as const;

export const GOVUK_DOMAIN_QUERY_TOPICS = [
  "eligibility-eyesight",
  "provisional-licence",
  "lessons-practice",
  "theory-preparation",
  "theory-test-management",
  "practical-test-management",
  "after-passing",
] as const;

export const DE_FAHRERLAUBNISRECHT_DOMAIN_QUERY_TOPICS = [
  "license-classes-eligibility",
  "fitness-to-drive-mpu",
  "penalties-license-withdrawal",
  "probationary-period",
  "special-permits-courses",
] as const;

export const DOMAIN_QUERY_TOPICS = [
  ...EXISTING_DOMAIN_QUERY_TOPICS,
  ...GOVUK_DOMAIN_QUERY_TOPICS,
  ...DE_FAHRERLAUBNISRECHT_DOMAIN_QUERY_TOPICS,
] as const;

export type DomainQueryTopic = (typeof DOMAIN_QUERY_TOPICS)[number];

export interface DomainPage {
  id: string;
  title: string;
}

export interface GeneratedIndexDomainCorpus {
  kind: "generated-index";
  pages: DomainPage[];
}

export interface SnapshotDomainDocument {
  id: string;
  url: string;
  title: string;
  description: string;
  body: string;
  contentHash: string;
}

export interface SnapshotDomainCorpus {
  kind: "snapshot";
  documents: SnapshotDomainDocument[];
}

export type DomainCorpus = GeneratedIndexDomainCorpus | SnapshotDomainCorpus;

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
  schemaVersion: 2;
  id: string;
  version: string;
  language: SupportedBaselineLanguage;
  provenance: SuiteProvenance;
  review: JudgmentReview;
  corpus: DomainCorpus;
  queries: DomainJudgedQuery[];
}
