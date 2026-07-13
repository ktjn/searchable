export const SUPPORTED_BASELINE_LANGUAGES = [
  "en",
  "de",
  "sv",
  "nl",
  "nb",
  "nn",
] as const;

export type SupportedBaselineLanguage =
  (typeof SUPPORTED_BASELINE_LANGUAGES)[number];
export type RelevanceGrade = 0 | 1 | 2 | 3;

export interface RelevanceDocument {
  id: string;
  title: string;
  body: string;
  url: string;
}

export interface JudgedQuery {
  id: string;
  text: string;
  judgments: Record<string, RelevanceGrade>;
}

export interface SuiteProvenance {
  publisher: string;
  sourceTitle: string;
  sourceUrl: string;
  license: string;
  licenseUrl: string;
  retrievedAt: string;
  attribution: string;
  selectionNotes: string;
}

export interface RelevanceSuite {
  schemaVersion: 1;
  id: string;
  version: string;
  language: SupportedBaselineLanguage;
  provenance: SuiteProvenance;
  documents: RelevanceDocument[];
  queries: JudgedQuery[];
}
