import {
  DOMAIN_QUERY_TOPICS,
  type DomainRelevanceSuite,
} from "./domain-schema.js";
import { SUPPORTED_BASELINE_LANGUAGES } from "./schema.js";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, path: string, errors: string[]): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path} must be an object`);
    return {};
  }
  return value as UnknownRecord;
}

function nonBlank(value: unknown, path: string, errors: string[]): string {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${path} must be a non-blank string`);
    return "";
  }
  return value;
}

function httpUrl(value: unknown, path: string, errors: string[]): void {
  const text = nonBlank(value, path, errors);
  if (!text) return;
  try {
    if (!/^https?:$/.test(new URL(text).protocol)) throw new Error();
  } catch {
    errors.push(`${path} must be an HTTP(S) URL`);
  }
}

function hasOwn(value: UnknownRecord, key: string): boolean {
  return Object.hasOwn(value, key);
}

function validateCorpus(value: unknown, errors: string[]): Set<string> {
  const corpus = record(value, "suite.corpus", errors);
  const documentIds = new Set<string>();

  if (corpus.kind === "generated-index") {
    if (hasOwn(corpus, "documents"))
      errors.push("generated-index corpus must omit documents");
    const pages = Array.isArray(corpus.pages) ? corpus.pages : [];
    if (!Array.isArray(corpus.pages) || pages.length === 0)
      errors.push("suite.corpus.pages must be a non-empty array");
    for (const [index, raw] of pages.entries()) {
      const page = record(raw, `suite.corpus.pages[${index}]`, errors);
      const id = nonBlank(page.id, `suite.corpus.pages[${index}].id`, errors);
      if (id && !id.startsWith("/"))
        errors.push(`suite.corpus.pages[${index}].id must start with /`);
      if (documentIds.has(id)) errors.push(`duplicate page id ${id}`);
      documentIds.add(id);
      nonBlank(page.title, `suite.corpus.pages[${index}].title`, errors);
    }
    return documentIds;
  }

  if (corpus.kind === "snapshot") {
    if (hasOwn(corpus, "pages")) errors.push("snapshot corpus must omit pages");
    const documents = Array.isArray(corpus.documents) ? corpus.documents : [];
    if (!Array.isArray(corpus.documents) || documents.length === 0)
      errors.push("suite.corpus.documents must be a non-empty array");
    for (const [index, raw] of documents.entries()) {
      const path = `suite.corpus.documents[${index}]`;
      const document = record(raw, path, errors);
      const id = nonBlank(document.id, `${path}.id`, errors);
      if (id && !id.startsWith("/"))
        errors.push(`${path}.id must start with /`);
      if (documentIds.has(id)) errors.push(`duplicate document id ${id}`);
      documentIds.add(id);

      const urlText = nonBlank(document.url, `${path}.url`, errors);
      if (urlText) {
        try {
          const url = new URL(urlText);
          if (url.protocol !== "https:")
            errors.push(`${path}.url must be an HTTPS URL`);
          if (id && url.pathname !== id)
            errors.push(`${path}.URL pathname must equal document id ${id}`);
        } catch {
          errors.push(`${path}.url must be an HTTPS URL`);
        }
      }
      for (const key of ["title", "description", "body"] as const)
        nonBlank(document[key], `${path}.${key}`, errors);
      if (
        typeof document.contentHash !== "string" ||
        !/^[a-f0-9]{64}$/.test(document.contentHash)
      )
        errors.push(`${path}.contentHash must be a lowercase SHA-256 hash`);
    }
    return documentIds;
  }

  errors.push('suite.corpus.kind must be "generated-index" or "snapshot"');
  return documentIds;
}

function isoDate(value: unknown, path: string, errors: string[]): void {
  const text = nonBlank(value, path, errors);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    errors.push(`${path} must be a valid YYYY-MM-DD date`);
    return;
  }
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== text)
    errors.push(`${path} must be a valid YYYY-MM-DD date`);
}

function validateProvenance(value: unknown, errors: string[]): void {
  const provenance = record(value, "suite.provenance", errors);
  for (const key of [
    "publisher",
    "sourceTitle",
    "license",
    "attribution",
    "selectionNotes",
  ] as const)
    nonBlank(provenance[key], `suite.provenance.${key}`, errors);
  httpUrl(provenance.sourceUrl, "suite.provenance.sourceUrl", errors);
  httpUrl(provenance.licenseUrl, "suite.provenance.licenseUrl", errors);
  isoDate(provenance.retrievedAt, "suite.provenance.retrievedAt", errors);
}

export function validateDomainSuite(value: unknown): DomainRelevanceSuite {
  const errors: string[] = [];
  const suite = record(value, "suite", errors);
  if (suite.schemaVersion !== 2) errors.push("suite.schemaVersion must be 2");
  nonBlank(suite.id, "suite.id", errors);
  nonBlank(suite.version, "suite.version", errors);
  if (
    typeof suite.language !== "string" ||
    !SUPPORTED_BASELINE_LANGUAGES.includes(suite.language as never)
  )
    errors.push("suite.language is not a supported baseline language");
  validateProvenance(suite.provenance, errors);
  const documentIds = validateCorpus(suite.corpus, errors);

  const review = record(suite.review, "suite.review", errors);
  nonBlank(review.method, "suite.review.method", errors);
  if (review.status === "draft") {
    if ("reviewer" in review || "reviewedAt" in review)
      errors.push("draft review must omit reviewer and reviewedAt");
  } else if (review.status === "reviewed") {
    nonBlank(review.reviewer, "suite.review.reviewer", errors);
    isoDate(review.reviewedAt, "suite.review.reviewedAt", errors);
  } else {
    errors.push('suite.review.status must be "draft" or "reviewed"');
  }

  const queries = Array.isArray(suite.queries) ? suite.queries : [];
  if (!Array.isArray(suite.queries) || queries.length === 0)
    errors.push("suite.queries must be a non-empty array");
  const queryIds = new Set<string>();
  for (const [index, raw] of queries.entries()) {
    const query = record(raw, `suite.queries[${index}]`, errors);
    const id = nonBlank(query.id, `suite.queries[${index}].id`, errors);
    if (queryIds.has(id)) errors.push(`duplicate query id ${id}`);
    queryIds.add(id);
    nonBlank(query.text, `suite.queries[${index}].text`, errors);
    if (
      typeof query.topic !== "string" ||
      !DOMAIN_QUERY_TOPICS.includes(query.topic as never)
    )
      errors.push(`query ${id} topic is not supported`);

    const judgments = record(
      query.judgments,
      `suite.queries[${index}].judgments`,
      errors,
    );
    const positiveIds: string[] = [];
    for (const [pageId, grade] of Object.entries(judgments)) {
      if (!documentIds.has(pageId)) {
        const noun =
          suite.corpus &&
          typeof suite.corpus === "object" &&
          !Array.isArray(suite.corpus) &&
          (suite.corpus as UnknownRecord).kind === "generated-index"
            ? "page"
            : "document";
        errors.push(
          `query ${id} judgment references unknown ${noun} ${pageId}`,
        );
      }
      if (!Number.isInteger(grade) || Number(grade) < 0 || Number(grade) > 3) {
        errors.push(`query ${id} judgment grade for ${pageId} must be 0..3`);
      } else if (Number(grade) >= 1) {
        positiveIds.push(pageId);
      }
    }
    if (positiveIds.length === 0)
      errors.push(`query ${id} must have a positive judgment`);

    const rationales = record(
      query.rationales,
      `suite.queries[${index}].rationales`,
      errors,
    );
    for (const [pageId, rationale] of Object.entries(rationales))
      nonBlank(
        rationale,
        `suite.queries[${index}].rationales.${pageId}`,
        errors,
      );
    const rationaleIds = Object.keys(rationales).sort();
    positiveIds.sort();
    if (JSON.stringify(positiveIds) !== JSON.stringify(rationaleIds))
      errors.push(
        `query ${id} rationale keys must exactly match positive judgments`,
      );
  }

  if (errors.length)
    throw new Error(
      `Invalid domain relevance suite:\n- ${errors.join("\n- ")}`,
    );
  return value as DomainRelevanceSuite;
}
