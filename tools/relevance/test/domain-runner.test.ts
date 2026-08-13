import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  readGeneratedPageInventory,
  runDomainSuite,
  runGeneratedDomainSuite,
} from "../src/domain-runner.js";
import type { DomainRelevanceSuite } from "../src/domain-schema.js";
import { prepareShowcase } from "../src/prepare-showcase.js";

const showcaseDist = fileURLToPath(
  new URL("../../../showcase/dist/", import.meta.url),
);
const relevancePackage = fileURLToPath(new URL("../", import.meta.url));
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

  it("accepts documentation indexes without a format field", async () => {
    const root = await temporaryIndex({
      shards: { docs: [] },
    });
    await expect(readGeneratedPageInventory(root)).resolves.toEqual([]);
  });

  it("rejects duplicate normalized page URLs", async () => {
    const root = await temporaryIndex(
      {
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
        shards: { docs: [{ file: "docs/0.json" }] },
      },
      { 0: { url: "/index.html", fields: {} } },
    );
    await expect(readGeneratedPageInventory(root)).rejects.toThrow(
      /missing a URL or title/,
    );
  });
});

it("prepares from the package directory without child-process warnings", async () => {
  const warnings: Error[] = [];
  const capture = (warning: Error) => warnings.push(warning);
  const originalDirectory = process.cwd();
  process.on("warning", capture);
  process.chdir(relevancePackage);
  try {
    await ensureShowcasePrepared();
    expect(warnings.map((warning) => warning.name)).not.toContain(
      "DeprecationWarning",
    );
  } finally {
    process.chdir(originalDirectory);
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
      corpus: { kind: "generated-index", pages: inventory },
      queries: [
        {
          id: "ranking",
          text: "ranking and boosts",
          topic: "lexical-features",
          judgments: { "/docs/guides/ranking-and-boosts.html": 3 },
          rationales: {
            "/docs/guides/ranking-and-boosts.html":
              "Directly documents ranking and boosts.",
          },
        },
      ],
    };
  }

  it("evaluates the real generated documentation index", async () => {
    const report = await runGeneratedDomainSuite(suite(), showcaseDist, 5);
    expect(
      report.queries.find((query) => query.id === "ranking")?.returnedIds[0],
    ).toBe("/docs/guides/ranking-and-boosts.html");
  });

  it("reports exact fixture and generated inventory drift", async () => {
    const value = suite();
    if (value.corpus.kind !== "generated-index") throw new Error("unreachable");
    value.corpus.pages = [
      ...value.corpus.pages.filter((page) => page.id !== "/index.html"),
      { id: "/missing.html", title: "Missing" },
    ].sort((left, right) => left.id.localeCompare(right.id));
    await expect(
      runGeneratedDomainSuite(value, showcaseDist, 5),
    ).rejects.toThrow(
      /missing from fixture: \/index\.html.*missing from generated index: \/missing\.html/s,
    );
  });

  it("rejects snapshot corpora", async () => {
    const value = suite();
    value.corpus = {
      kind: "snapshot",
      documents: [
        {
          id: "/learn",
          url: "https://www.gov.uk/learn",
          title: "Learn to drive a car",
          description: "The steps needed to learn to drive.",
          body: "Apply for a provisional licence and prepare for your tests.",
          contentHash: "a".repeat(64),
        },
      ],
    };
    value.queries[0].judgments = { "/learn": 3 };
    value.queries[0].rationales = { "/learn": "Directly answers the query." };
    value.queries.splice(1);
    await expect(
      runGeneratedDomainSuite(value, showcaseDist, 5),
    ).rejects.toThrow(/requires a generated-index corpus/);
  });
});

describe("runDomainSuite", () => {
  it("builds and evaluates a snapshot corpus without a showcase", async () => {
    const suite: DomainRelevanceSuite = {
      schemaVersion: 2,
      id: "driving-test",
      version: "1.0.0",
      language: "en",
      provenance: {
        publisher: "GOV.UK",
        sourceTitle: "Learn to drive a car",
        sourceUrl: "https://www.gov.uk/learn-to-drive-a-car",
        license: "Open Government Licence v3.0",
        licenseUrl:
          "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
        retrievedAt: "2026-07-13",
        attribution:
          "Contains public sector information licensed under the Open Government Licence v3.0.",
        selectionNotes: "Test fixture.",
      },
      review: { status: "draft", method: "Maintainer review." },
      corpus: {
        kind: "snapshot",
        documents: [
          {
            id: "/eyesight",
            url: "https://www.gov.uk/eyesight",
            title: "Driving eyesight rules",
            description: "Eyesight rules for drivers.",
            body: "Read a number plate from 20 metres.",
            contentHash: "a".repeat(64),
          },
          {
            id: "/licence",
            url: "https://www.gov.uk/licence",
            title: "Provisional licence",
            description: "Apply for a provisional licence.",
            body: "Apply online before taking lessons.",
            contentHash: "b".repeat(64),
          },
        ],
      },
      queries: [
        {
          id: "number-plate",
          text: "number plate eyesight",
          topic: "setup",
          judgments: { "/eyesight": 3 },
          rationales: {
            "/eyesight": "States the number-plate eyesight requirement.",
          },
        },
      ],
    };

    const report = await runDomainSuite(suite, "unused", 5);
    expect(report.queries[0].returnedIds[0]).toBe("/eyesight");
  });
});
