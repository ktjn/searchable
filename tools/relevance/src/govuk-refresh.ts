import {
  readFile as defaultReadFile,
  rename as defaultRename,
  rm as defaultRm,
  writeFile as defaultWriteFile,
} from "node:fs/promises";
import type { SnapshotDomainDocument } from "./domain-schema.js";
import { normalizeGovukDocument } from "./govuk-normalize.js";
import { hashSnapshotContent } from "./snapshot-hash.js";
import { validateDomainSuite } from "./validate-domain-suite.js";
import { expectRecord as record, type UnknownRecord } from "./validation.js";

export const GOVUK_JOURNEY_PATH = "/learn-to-drive-a-car";
export const GOVUK_EXPECTED_ROUTES = [
  "/learn-to-drive-a-car",
  "/vehicles-can-drive",
  "/legal-obligations-drivers-riders",
  "/driving-eyesight-rules",
  "/apply-first-provisional-driving-licence",
  "/guidance/the-highway-code",
  "/driving-lessons-learning-to-drive",
  "/find-driving-schools-and-lessons",
  "/government/publications/car-show-me-tell-me-vehicle-safety-questions",
  "/theory-test/revision-and-practice",
  "/take-practice-theory-test",
  "/book-theory-test",
  "/theory-test/what-to-take",
  "/change-theory-test",
  "/check-theory-test",
  "/cancel-theory-test",
  "/book-driving-test",
  "/driving-test/what-to-take",
  "/change-driving-test",
  "/check-driving-test",
  "/cancel-driving-test",
  "/pass-plus",
] as const;

const EXCLUDED_EXTERNAL_DESTINATION = "https://onelink.to/858uyu";
const REVIEW_METHOD =
  "Maintainer review of every normalized document, query, grade, rationale, and measured top-five result.";

const EXPECTED_PROVENANCE = {
  publisher: "Government Digital Service and GOV.UK publishing organisations",
  sourceTitle: "Learn to drive a car: step by step",
  sourceUrl: "https://www.gov.uk/learn-to-drive-a-car",
  license: "Open Government Licence v3.0",
  licenseUrl:
    "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
  attribution:
    "Contains public sector information licensed under the Open Government Licence v3.0.",
  selectionNotes:
    "The journey hub and its 21 internal GOV.UK destinations are included. The external theory-test application and neighboring pages are excluded. Searchable text is normalized from the GOV.UK Content API.",
} as const;

export interface SnapshotComparison {
  addedRoutes: string[];
  removedRoutes: string[];
  changedRoutes: string[];
}

export interface RefreshOptions {
  mode: "check" | "write";
  fixturePath: string;
  version?: string;
  sourceCreditAudit?: boolean;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  readFile?: typeof defaultReadFile;
  writeFile?: typeof defaultWriteFile;
  rename?: typeof defaultRename;
  rm?: typeof defaultRm;
}

function collectHrefs(value: unknown, hrefs: unknown[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectHrefs(entry, hrefs);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value as UnknownRecord)) {
    if (key === "href") hrefs.push(entry);
    else collectHrefs(entry, hrefs);
  }
}

export function extractJourneyRoutes(value: unknown): string[] {
  const hub = record(value, "hub");
  if (hub.schema_name !== "step_by_step_nav")
    throw new Error("hub schema must be step_by_step_nav");
  const details = record(hub.details, "hub.details");
  const navigation = record(
    details.step_by_step_nav,
    "hub.details.step_by_step_nav",
  );
  if (!Array.isArray(navigation.steps))
    throw new Error("hub step_by_step_nav.steps must be an array");

  const rawHrefs: unknown[] = [];
  collectHrefs(navigation.steps, rawHrefs);
  const routes: string[] = [];
  const external: string[] = [];
  const seen = new Set<string>();
  for (const rawHref of rawHrefs) {
    if (typeof rawHref !== "string")
      throw new Error("journey href must be a string");
    if (rawHref.startsWith("/")) {
      if (seen.has(rawHref))
        throw new Error(`duplicate journey route ${rawHref}`);
      seen.add(rawHref);
      routes.push(rawHref);
    } else {
      external.push(rawHref);
    }
  }
  if (external.length !== 1 || external[0] !== EXCLUDED_EXTERNAL_DESTINATION)
    throw new Error(
      "journey must contain exactly one approved external destination",
    );

  const expected = GOVUK_EXPECTED_ROUTES.slice(1);
  if (
    routes.length !== expected.length ||
    routes.some((route, index) => route !== expected[index])
  )
    throw new Error("journey route inventory differs from the approved routes");
  return routes;
}

function documentMap(
  documents: readonly SnapshotDomainDocument[],
  label: string,
): Map<string, SnapshotDomainDocument> {
  const result = new Map<string, SnapshotDomainDocument>();
  for (const document of documents) {
    if (result.has(document.id))
      throw new Error(`duplicate route ${document.id} in ${label} snapshot`);
    result.set(document.id, document);
  }
  return result;
}

export function compareSnapshot(
  currentDocuments: readonly SnapshotDomainDocument[],
  nextDocuments: readonly SnapshotDomainDocument[],
): SnapshotComparison {
  const current = documentMap(currentDocuments, "current");
  const next = documentMap(nextDocuments, "next");
  return {
    addedRoutes: [...next.keys()].filter((route) => !current.has(route)).sort(),
    removedRoutes: [...current.keys()]
      .filter((route) => !next.has(route))
      .sort(),
    changedRoutes: [...next.entries()]
      .filter(
        ([route, document]) =>
          current.has(route) &&
          current.get(route)?.contentHash !== document.contentHash,
      )
      .map(([route]) => route)
      .sort(),
  };
}

function assertExactProvenance(suite: UnknownRecord): void {
  const provenance = record(suite.provenance, "suite.provenance");
  if (
    Object.entries(EXPECTED_PROVENANCE).some(
      ([key, expected]) => provenance[key] !== expected,
    ) ||
    typeof provenance.retrievedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(provenance.retrievedAt)
  )
    throw new Error("suite must contain the exact GOV.UK OGL provenance");
}

function rawSuite(value: unknown): {
  suite: UnknownRecord;
  corpus: UnknownRecord;
  documents: SnapshotDomainDocument[];
} {
  const suite = record(value, "suite");
  if (
    suite.schemaVersion !== 2 ||
    suite.id !== "govuk-learn-to-drive" ||
    suite.language !== "en"
  )
    throw new Error("fixture must be the GOV.UK learn-to-drive domain suite");
  assertExactProvenance(suite);
  const corpus = record(suite.corpus, "suite.corpus");
  if (corpus.kind !== "snapshot")
    throw new Error("GOV.UK fixture must use a snapshot corpus");
  if (!Array.isArray(corpus.documents))
    throw new Error("suite.corpus.documents must be an array");
  if (!Array.isArray(suite.queries) || suite.queries.length === 0)
    throw new Error("suite.queries must be a non-empty array");
  if (corpus.documents.length > 0) validateDomainSuite(value);
  return {
    suite,
    corpus,
    documents: corpus.documents as SnapshotDomainDocument[],
  };
}

function semanticVersion(value: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) throw new Error("version must be a semantic version");
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isGreaterVersion(next: string, current: string): boolean {
  const nextParts = semanticVersion(next);
  const currentParts = semanticVersion(current);
  for (let index = 0; index < nextParts.length; index++) {
    const nextPart = nextParts[index] ?? 0;
    const currentPart = currentParts[index] ?? 0;
    if (nextPart > currentPart) return true;
    if (nextPart < currentPart) return false;
  }
  return false;
}

async function fetchItem(
  route: string,
  fetcher: typeof globalThis.fetch,
): Promise<unknown> {
  const response = await fetcher(`https://www.gov.uk/api/content${route}`);
  if (!response.ok)
    throw new Error(
      `GOV.UK Content API ${route} returned HTTP ${response.status}`,
    );
  if (
    !response.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new Error(`GOV.UK Content API ${route} must return JSON`);
  const finalUrl = new URL(response.url);
  if (
    finalUrl.origin !== "https://www.gov.uk" ||
    !finalUrl.pathname.startsWith("/api/content/")
  )
    throw new Error(
      `GOV.UK Content API ${route} redirected outside GOV.UK Content API`,
    );
  return response.json();
}

async function fetchDocuments(
  fetcher: typeof globalThis.fetch,
): Promise<SnapshotDomainDocument[]> {
  const hub = await fetchItem(GOVUK_JOURNEY_PATH, fetcher);
  const routes = extractJourneyRoutes(hub);
  const documents = [normalizeGovukDocument(GOVUK_JOURNEY_PATH, hub)];
  for (const route of routes) {
    const document = normalizeGovukDocument(
      route,
      await fetchItem(route, fetcher),
    );
    if (
      !/^[a-f0-9]{64}$/.test(document.contentHash) ||
      document.contentHash !== hashSnapshotContent(document)
    )
      throw new Error(`content hash validation failed for ${route}`);
    documents.push(document);
  }
  documentMap(documents, "fetched");
  return documents;
}

export async function refreshGovukSuite(
  options: RefreshOptions,
): Promise<SnapshotComparison> {
  const read = options.readFile ?? defaultReadFile;
  const write = options.writeFile ?? defaultWriteFile;
  const rename = options.rename ?? defaultRename;
  const remove = options.rm ?? defaultRm;
  const fetcher = options.fetch ?? globalThis.fetch;
  const original = await read(options.fixturePath, "utf8");
  const parsed: unknown = JSON.parse(original);
  const current = rawSuite(parsed);

  if (options.mode === "write") {
    if (!options.sourceCreditAudit)
      throw new Error("sourceCreditAudit is required for snapshot writes");
    if (!options.version)
      throw new Error("version is required for snapshot writes");
    if (typeof current.suite.version !== "string")
      throw new Error("committed version must be a semantic version");
    if (!isGreaterVersion(options.version, current.suite.version))
      throw new Error("write version must be greater than committed version");
  }

  const documents = await fetchDocuments(fetcher);
  const comparison = compareSnapshot(current.documents, documents);
  if (options.mode === "check") return comparison;

  const candidate = structuredClone(parsed) as UnknownRecord;
  const candidateCorpus = record(candidate.corpus, "suite.corpus");
  candidateCorpus.documents = documents;
  candidate.version = options.version;
  const candidateProvenance = record(candidate.provenance, "suite.provenance");
  candidateProvenance.retrievedAt = (options.now ?? (() => new Date()))()
    .toISOString()
    .slice(0, 10);
  candidate.review = { status: "draft", method: REVIEW_METHOD };
  validateDomainSuite(candidate);

  const temporaryPath = `${options.fixturePath}.tmp-${process.pid}`;
  try {
    await write(
      temporaryPath,
      `${JSON.stringify(candidate, null, 2)}\n`,
      "utf8",
    );
    await rename(temporaryPath, options.fixturePath);
  } finally {
    await remove(temporaryPath, { force: true });
  }
  return comparison;
}
