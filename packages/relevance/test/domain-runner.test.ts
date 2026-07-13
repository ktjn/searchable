import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  readGeneratedPageInventory,
  runGeneratedDomainSuite,
} from "../src/domain-runner.js";
import type { DomainRelevanceSuite } from "../src/domain-schema.js";
import { prepareShowcase } from "../src/prepare-showcase.js";

const showcaseDist = fileURLToPath(
  new URL("../../../showcase/dist/", import.meta.url),
);
const temporaryDirectories: string[] = [];
let showcasePreparation: Promise<void> | undefined;

function ensureShowcasePrepared(): Promise<void> {
  showcasePreparation ??= prepareShowcase();
  return showcasePreparation;
}

async function temporaryIndex(
  manifest: unknown,
  docs?: unknown,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "searchable-domain-index-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "search-index", "docs"), { recursive: true });
  await writeFile(
    join(root, "search-index", "manifest.json"),
    JSON.stringify(manifest),
  );
  if (docs !== undefined)
    await writeFile(
      join(root, "search-index", "docs", "0.json"),
      JSON.stringify(docs),
    );
  return root;
}

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("readGeneratedPageInventory", () => {
  it("reads stored page URLs and normalizes Windows separators", async () => {
    const root = await temporaryIndex(
      {
        format: "json",
        shards: { docs: [{ file: "docs/0.json" }] },
      },
      {
        0: { url: "/index.html", fields: { title: "Searchable" } },
        1: {
          url: "/docs\\guides\\offline-search.html",
          fields: { title: "Offline search" },
        },
      },
    );

    expect(await readGeneratedPageInventory(root)).toEqual([
      {
        id: "/docs/guides/offline-search.html",
        title: "Offline search",
      },
      { id: "/index.html", title: "Searchable" },
    ]);
  });

  it("rejects non-JSON documentation indexes", async () => {
    const root = await temporaryIndex({
      format: "binary",
      shards: { docs: [] },
    });
    await expect(readGeneratedPageInventory(root)).rejects.toThrow(
      /must use JSON document shards/,
    );
  });

  it("rejects duplicate normalized page URLs", async () => {
    const root = await temporaryIndex(
      {
        format: "json",
        shards: { docs: [{ file: "docs/0.json" }] },
      },
      {
        0: { url: "/docs/page.html", fields: { title: "Page" } },
        1: { url: "/docs\\page.html", fields: { title: "Page" } },
      },
    );
    await expect(readGeneratedPageInventory(root)).rejects.toThrow(
      /duplicate generated page \/docs\/page\.html/,
    );
  });

  it("rejects malformed stored page entries", async () => {
    const root = await temporaryIndex(
      {
        format: "json",
        shards: { docs: [{ file: "docs/0.json" }] },
      },
      { 0: { url: "/index.html", fields: {} } },
    );
    await expect(readGeneratedPageInventory(root)).rejects.toThrow(
      /missing a URL or title/,
    );
  });
});

it("prepares the showcase without Node child-process deprecation warnings", async () => {
  const warnings: Error[] = [];
  const capture = (warning: Error) => warnings.push(warning);
  process.on("warning", capture);
  try {
    await ensureShowcasePrepared();
    expect(warnings.map((warning) => warning.name)).not.toContain(
      "DeprecationWarning",
    );
  } finally {
    process.off("warning", capture);
  }
}, 120_000);

describe("runGeneratedDomainSuite", () => {
  let inventory: Awaited<ReturnType<typeof readGeneratedPageInventory>>;

  beforeAll(async () => {
    await ensureShowcasePrepared();
    inventory = await readGeneratedPageInventory(showcaseDist);
  }, 120_000);

  function suite(): DomainRelevanceSuite {
    return {
      schemaVersion: 1,
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
      pages: inventory,
      queries: [
        {
          id: "offline",
          text: "offline search",
          topic: "offline-worker",
          judgments: { "/docs/guides/offline-search.html": 3 },
          rationales: {
            "/docs/guides/offline-search.html":
              "Directly documents offline search.",
          },
        },
        {
          id: "vector",
          text: "vector hybrid search",
          topic: "vector-hybrid",
          judgments: { "/docs/guides/vector-search.html": 3 },
          rationales: {
            "/docs/guides/vector-search.html":
              "Directly documents vector and hybrid search.",
          },
        },
      ],
    };
  }

  it("evaluates the real generated documentation index", async () => {
    const report = await runGeneratedDomainSuite(suite(), showcaseDist, 5);
    expect(
      report.queries.find((query) => query.id === "offline")?.returnedIds[0],
    ).toBe("/docs/guides/offline-search.html");
    expect(
      report.queries.find((query) => query.id === "vector")?.returnedIds[0],
    ).toBe("/docs/guides/vector-search.html");
  });

  it("reports exact fixture and generated inventory drift", async () => {
    const value = suite();
    value.pages = [
      ...value.pages.filter((page) => page.id !== "/index.html"),
      { id: "/missing.html", title: "Missing" },
    ].sort((left, right) => left.id.localeCompare(right.id));
    await expect(
      runGeneratedDomainSuite(value, showcaseDist, 5),
    ).rejects.toThrow(
      /missing from fixture: \/index\.html.*missing from generated index: \/missing\.html/s,
    );
  });
});
