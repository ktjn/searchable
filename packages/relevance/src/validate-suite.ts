import { type RelevanceSuite, SUPPORTED_BASELINE_LANGUAGES } from "./schema.js";
import { httpUrl, isoDate, nonBlank, record } from "./validation.js";

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
