import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type RelevanceSuite,
  SUPPORTED_BASELINE_LANGUAGES,
  type SupportedBaselineLanguage,
} from "./schema.js";
import { httpUrl, isoDate, nonBlank, record } from "./validation.js";

/**
 * Validates a v1 baseline relevance suite (schemaVersion 1 -- the six
 * per-language baseline corpora). Folded into this module, with its v2
 * counterpart, because validation only ever runs at load time and the two
 * loaders share the same shape expectations for provenance/queries.
 */
export function validateSuite(value: unknown): RelevanceSuite {
  const errors: string[] = [];
  const suite = record(value, "suite", errors);
  if (suite.schemaVersion !== 1) errors.push("suite.schemaVersion must be 1");
  nonBlank(suite.id, "suite.id", errors);
  nonBlank(suite.version, "suite.version", errors);
  if (
    typeof suite.language !== "string" ||
    !SUPPORTED_BASELINE_LANGUAGES.includes(suite.language as never)
  )
    errors.push("suite.language is not a supported baseline language");

  const provenance = record(suite.provenance, "suite.provenance", errors);
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

  const documents = Array.isArray(suite.documents) ? suite.documents : [];
  if (!Array.isArray(suite.documents) || documents.length === 0)
    errors.push("suite.documents must be a non-empty array");
  const documentIds = new Set<string>();
  for (const [index, raw] of documents.entries()) {
    const doc = record(raw, `suite.documents[${index}]`, errors);
    const id = nonBlank(doc.id, `suite.documents[${index}].id`, errors);
    if (documentIds.has(id)) errors.push(`duplicate document id ${id}`);
    documentIds.add(id);
    nonBlank(doc.title, `suite.documents[${index}].title`, errors);
    nonBlank(doc.body, `suite.documents[${index}].body`, errors);
    httpUrl(doc.url, `suite.documents[${index}].url`, errors);
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
    const judgments = record(
      query.judgments,
      `suite.queries[${index}].judgments`,
      errors,
    );
    let positive = false;
    for (const [documentId, grade] of Object.entries(judgments)) {
      if (!documentIds.has(documentId))
        errors.push(
          `query ${id} judgment references unknown document ${documentId}`,
        );
      if (!Number.isInteger(grade) || Number(grade) < 0 || Number(grade) > 3)
        errors.push(
          `query ${id} judgment grade for ${documentId} must be 0..3`,
        );
      else if (Number(grade) >= 1) positive = true;
    }
    if (!positive) errors.push(`query ${id} must have a positive judgment`);
  }

  if (errors.length)
    throw new Error(`Invalid relevance suite:\n- ${errors.join("\n- ")}`);
  return value as RelevanceSuite;
}

export async function loadSuites(
  directory: string,
  selectedLanguage?: SupportedBaselineLanguage,
): Promise<RelevanceSuite[]> {
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".json"))
    .sort();
  const suites: RelevanceSuite[] = [];
  for (const name of names) {
    const language = name.slice(0, -5);
    if (selectedLanguage && language !== selectedLanguage) continue;
    const suite = validateSuite(
      JSON.parse(await readFile(join(directory, name), "utf8")),
    );
    if (suite.language !== language)
      throw new Error(`Fixture ${name} declares language ${suite.language}`);
    suites.push(suite);
  }
  const required = selectedLanguage
    ? [selectedLanguage]
    : [...SUPPORTED_BASELINE_LANGUAGES];
  for (const language of required) {
    const count = suites.filter((suite) => suite.language === language).length;
    if (count !== 1)
      throw new Error(`Expected exactly one ${language} suite, found ${count}`);
  }
  const order = new Map(
    SUPPORTED_BASELINE_LANGUAGES.map((language, index) => [language, index]),
  );
  return suites.sort(
    (left, right) =>
      (order.get(left.language) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.language) ?? Number.MAX_SAFE_INTEGER),
  );
}
