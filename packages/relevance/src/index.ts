export {
  normalizePageId,
  readGeneratedPageInventory,
  runGeneratedDomainSuite,
} from "./domain-runner.js";
export type {
  DomainCorpus,
  DomainJudgedQuery,
  DomainPage,
  DomainQueryTopic,
  DomainRelevanceSuite,
  GeneratedIndexDomainCorpus,
  JudgmentReview,
  SnapshotDomainCorpus,
  SnapshotDomainDocument,
} from "./domain-schema.js";
export { DOMAIN_QUERY_TOPICS } from "./domain-schema.js";
export type {
  QueryReport,
  SearchForEvaluation,
  SuiteReport,
} from "./evaluate.js";
export { evaluateSuite } from "./evaluate.js";
export type { KnownDomainSuite } from "./load-domain-suite.js";
export {
  KNOWN_DOMAIN_SUITES,
  loadDomainSuite,
} from "./load-domain-suite.js";
export { loadSuites } from "./load-suites.js";
export type { Judgments, RankingMetrics } from "./metrics.js";
export {
  evaluateRanking,
  isZeroResult,
  ndcgAtK,
  precisionAtK,
  recallAtK,
  reciprocalRank,
} from "./metrics.js";
export { prepareShowcase } from "./prepare-showcase.js";
export { renderConsoleReport, serializeJsonReport } from "./report.js";
export type {
  JudgedQuery,
  RelevanceDocument,
  RelevanceGrade,
  RelevanceSuite,
  SuiteProvenance,
  SupportedBaselineLanguage,
} from "./schema.js";
export { SUPPORTED_BASELINE_LANGUAGES } from "./schema.js";
export { runSearchableSuite } from "./searchable-runner.js";
export { validateDomainSuite } from "./validate-domain-suite.js";
export { validateSuite } from "./validate-suite.js";
