import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { loadSuites } from "../src/load-suites.js";
import type { SupportedBaselineLanguage } from "../src/schema.js";

let directory: string | undefined;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

function suite(language: SupportedBaselineLanguage) {
  return {
    schemaVersion: 1,
    id: `${language}-suite`,
    version: "1.0.0",
    language,
    provenance: {
      publisher: "Example",
      sourceTitle: "Help",
      sourceUrl: `https://example.test/${language}`,
      license: "CC-BY-4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      retrievedAt: "2026-07-13",
      attribution: "Example",
      selectionNotes: "Verbatim help pairs.",
    },
    documents: [{ id: "a", title: "A", body: "Answer", url: `https://example.test/${language}#a` }],
    queries: [{ id: "q", text: "Question", judgments: { a: 3 } }],
  };
}

it("loads all suites in supported language order", async () => {
  directory = await mkdtemp(join(tmpdir(), "relevance-suites-"));
  for (const language of ["nn", "nb", "nl", "sv", "de", "en"] as const)
    await writeFile(join(directory, `${language}.json`), JSON.stringify(suite(language)));
  expect((await loadSuites(directory)).map((item) => item.language)).toEqual([
    "en", "de", "sv", "nl", "nb", "nn",
  ]);
});

it("can select one language without requiring the others", async () => {
  directory = await mkdtemp(join(tmpdir(), "relevance-suites-"));
  await writeFile(join(directory, "sv.json"), JSON.stringify(suite("sv")));
  expect((await loadSuites(directory, "sv")).map((item) => item.language)).toEqual(["sv"]);
});
