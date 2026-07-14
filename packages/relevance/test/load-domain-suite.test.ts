import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import {
  KNOWN_DOMAIN_SUITES,
  loadDomainSuite,
} from "../src/load-domain-suite.js";

let directory: string | undefined;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

function suite() {
  return {
    schemaVersion: 2,
    id: "searchable-docs",
    version: "1.0.0",
    language: "en",
    provenance: {
      publisher: "Searchable contributors",
      sourceTitle: "Searchable documentation",
      sourceUrl: "https://ktjn.github.io/searchable/",
      license: "MIT",
      licenseUrl: "https://github.com/ktjn/searchable/blob/main/LICENSE",
      retrievedAt: "2026-07-13",
      attribution: "Searchable contributors",
      selectionNotes: "All generated documentation pages are included.",
    },
    review: { status: "draft", method: "Maintainer review." },
    corpus: {
      kind: "generated-index",
      pages: [{ id: "/index.html", title: "Searchable" }],
    },
    queries: [
      {
        id: "overview",
        text: "what is searchable",
        topic: "setup",
        judgments: { "/index.html": 3 },
        rationales: { "/index.html": "Introduces the project." },
      },
    ],
  };
}

it("loads an allowlisted domain suite", async () => {
  directory = await mkdtemp(join(tmpdir(), "relevance-domains-"));
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "searchable-docs.json"),
    JSON.stringify(suite()),
  );
  expect((await loadDomainSuite(directory, "searchable-docs")).id).toBe(
    "searchable-docs",
  );
});

it("loads both committed allowlisted domain suites", async () => {
  const fixtureDirectory = fileURLToPath(
    new URL("../fixtures/domains/", import.meta.url),
  );
  expect(KNOWN_DOMAIN_SUITES).toEqual([
    "searchable-docs",
    "govuk-learn-to-drive",
  ]);
  await expect(
    loadDomainSuite(fixtureDirectory, "govuk-learn-to-drive"),
  ).resolves.toMatchObject({ id: "govuk-learn-to-drive", version: "1.0.0" });
});

it("rejects unknown suite names before filesystem access", async () => {
  directory = await mkdtemp(join(tmpdir(), "relevance-domains-"));
  await expect(loadDomainSuite(directory, "unknown" as never)).rejects.toThrow(
    /unknown domain suite: unknown/,
  );
});

it("rejects a fixture whose declared ID differs from its name", async () => {
  directory = await mkdtemp(join(tmpdir(), "relevance-domains-"));
  const value = suite();
  value.id = "different";
  await writeFile(
    join(directory, "searchable-docs.json"),
    JSON.stringify(value),
  );
  await expect(loadDomainSuite(directory, "searchable-docs")).rejects.toThrow(
    /declares id different/,
  );
});
