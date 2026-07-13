import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SearchClient } from "@ktjn/searchable-client";
import type {
  DomainPage,
  DomainRelevanceSuite,
  GeneratedIndexDomainCorpus,
} from "./domain-schema.js";
import { evaluateSuite, type SuiteReport } from "./evaluate.js";
import type { RelevanceSuite } from "./schema.js";
import { runSearchableSuite } from "./searchable-runner.js";
import { type StaticServer, serveDirectory } from "./static-server.js";
import { validateDomainSuite } from "./validate-domain-suite.js";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, path: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path} must be an object`);
  return value as UnknownRecord;
}

export function normalizePageId(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

export async function readGeneratedPageInventory(
  showcaseDistDirectory: string,
): Promise<DomainPage[]> {
  const indexDirectory = join(showcaseDistDirectory, "search-index");
  const manifest = record(
    JSON.parse(await readFile(join(indexDirectory, "manifest.json"), "utf8")),
    "generated manifest",
  );
  if (manifest.format !== "json")
    throw new Error(
      "Generated documentation index must use JSON document shards",
    );
  const shards = record(manifest.shards, "generated manifest.shards");
  if (!Array.isArray(shards.docs))
    throw new Error("generated manifest.shards.docs must be an array");

  const pages: DomainPage[] = [];
  const pageIds = new Set<string>();
  for (const [shardIndex, rawShard] of shards.docs.entries()) {
    const shard = record(rawShard, `generated docs shard ${shardIndex}`);
    if (typeof shard.file !== "string" || shard.file.trim() === "")
      throw new Error(`generated docs shard ${shardIndex} must name a file`);
    const entries = record(
      JSON.parse(await readFile(join(indexDirectory, shard.file), "utf8")),
      `generated docs shard ${shard.file}`,
    );
    for (const [documentId, rawEntry] of Object.entries(entries)) {
      const entry = record(
        rawEntry,
        `generated document ${documentId} in ${shard.file}`,
      );
      const fields = record(
        entry.fields,
        `generated document ${documentId} fields`,
      );
      if (
        typeof entry.url !== "string" ||
        entry.url.trim() === "" ||
        typeof fields.title !== "string" ||
        fields.title.trim() === ""
      )
        throw new Error(
          `generated document ${documentId} is missing a URL or title`,
        );
      const id = normalizePageId(entry.url);
      if (pageIds.has(id)) throw new Error(`duplicate generated page ${id}`);
      pageIds.add(id);
      pages.push({ id, title: fields.title });
    }
  }
  return pages.sort((left, right) => left.id.localeCompare(right.id));
}

function assertMatchingInventory(
  fixturePages: readonly DomainPage[],
  generatedPages: readonly DomainPage[],
): void {
  const fixture = new Map(fixturePages.map((page) => [page.id, page.title]));
  const generated = new Map(
    generatedPages.map((page) => [page.id, page.title]),
  );
  const missingFromFixture = [...generated.keys()]
    .filter((id) => !fixture.has(id))
    .sort();
  const missingFromGenerated = [...fixture.keys()]
    .filter((id) => !generated.has(id))
    .sort();
  const titleMismatches = [...fixture.entries()]
    .filter(([id, title]) => generated.has(id) && generated.get(id) !== title)
    .map(
      ([id, title]) =>
        `${id} (fixture ${JSON.stringify(title)}, generated ${JSON.stringify(generated.get(id))})`,
    )
    .sort();
  const details = [
    missingFromFixture.length
      ? `missing from fixture: ${missingFromFixture.join(", ")}`
      : "",
    missingFromGenerated.length
      ? `missing from generated index: ${missingFromGenerated.join(", ")}`
      : "",
    titleMismatches.length
      ? `title mismatches: ${titleMismatches.join(", ")}`
      : "",
  ].filter(Boolean);
  if (details.length)
    throw new Error(`Documentation corpus drift:\n- ${details.join("\n- ")}`);
}

type GeneratedDomainSuite = DomainRelevanceSuite & {
  corpus: GeneratedIndexDomainCorpus;
};

function assertGeneratedCorpus(
  suite: DomainRelevanceSuite,
): asserts suite is GeneratedDomainSuite {
  if (suite.corpus.kind !== "generated-index")
    throw new Error(
      "Generated domain evaluation requires a generated-index corpus",
    );
}

function toEvaluationSuite(suite: GeneratedDomainSuite): RelevanceSuite {
  return {
    schemaVersion: 1,
    id: suite.id,
    version: suite.version,
    language: suite.language,
    provenance: suite.provenance,
    documents: suite.corpus.pages.map((page) => ({
      id: page.id,
      title: page.title,
      body: page.title,
      url: new URL(page.id, suite.provenance.sourceUrl).href,
    })),
    queries: suite.queries.map(({ id, text, judgments }) => ({
      id,
      text,
      judgments,
    })),
  };
}

function toSnapshotEvaluationSuite(
  suite: DomainRelevanceSuite,
): RelevanceSuite {
  if (suite.corpus.kind !== "snapshot")
    throw new Error("Snapshot runner requires corpus kind snapshot");
  return {
    schemaVersion: 1,
    id: suite.id,
    version: suite.version,
    language: suite.language,
    provenance: suite.provenance,
    documents: suite.corpus.documents.map((document) => ({
      id: document.id,
      url: document.url,
      title: document.title,
      body: `${document.description}\n${document.body}`,
    })),
    queries: suite.queries.map(({ id, text, judgments }) => ({
      id,
      text,
      judgments,
    })),
  };
}

export async function runGeneratedDomainSuite(
  suite: DomainRelevanceSuite,
  showcaseDistDirectory: string,
  k = 5,
): Promise<SuiteReport> {
  validateDomainSuite(suite);
  assertGeneratedCorpus(suite);
  assertMatchingInventory(
    suite.corpus.pages,
    await readGeneratedPageInventory(showcaseDistDirectory),
  );
  let server: StaticServer | undefined;
  let client: SearchClient | undefined;
  try {
    server = await serveDirectory(showcaseDistDirectory);
    client = new SearchClient({
      indexUrl: `${server.baseUrl}search-index/manifest.json`,
      worker: false,
      strict: true,
    });
    await client.ready();
    return await evaluateSuite(
      toEvaluationSuite(suite),
      async (query, options) => {
        const result = await client?.search(query, {
          ...options,
          mode: "lexical",
        });
        return (result?.hits ?? []).map((hit) => normalizePageId(hit.url));
      },
      k,
    );
  } finally {
    client?.dispose();
    await server?.close();
  }
}

export async function runDomainSuite(
  suite: DomainRelevanceSuite,
  showcaseDistDirectory: string,
  k = 5,
): Promise<SuiteReport> {
  validateDomainSuite(suite);
  return suite.corpus.kind === "generated-index"
    ? runGeneratedDomainSuite(suite, showcaseDistDirectory, k)
    : runSearchableSuite(toSnapshotEvaluationSuite(suite), k);
}
