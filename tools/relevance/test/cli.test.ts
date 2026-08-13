import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CliDependencies,
  defaultCliDependencies,
  main,
  parseCliArgs,
} from "../src/cli.js";
import type { DomainRelevanceSuite } from "../src/domain-schema.js";
import type { SuiteReport } from "../src/evaluate.js";
import { prepareShowcase } from "../src/prepare-showcase.js";
import type { RelevanceSuite } from "../src/schema.js";

vi.mock("../src/prepare-showcase.js", () => ({
  prepareShowcase: vi.fn(async () => undefined),
}));

describe("parseCliArgs", () => {
  it("uses all-language defaults", () => {
    expect(parseCliArgs([])).toEqual({ k: 5, json: false });
  });

  it("parses language, cutoff, and JSON output", () => {
    expect(parseCliArgs(["--language", "sv", "--k", "10", "--json"])).toEqual({
      language: "sv",
      k: 10,
      json: true,
    });
  });

  it("parses a known domain suite", () => {
    expect(parseCliArgs(["--suite", "searchable-docs", "--json"])).toEqual({
      suite: "searchable-docs",
      k: 5,
      json: true,
    });
  });

  it("parses the GOV.UK domain suite", () => {
    expect(parseCliArgs(["--suite", "govuk-learn-to-drive"])).toEqual({
      suite: "govuk-learn-to-drive",
      k: 5,
      json: false,
    });
  });

  it("rejects simultaneous suite and language selectors", () => {
    expect(() =>
      parseCliArgs(["--suite", "searchable-docs", "--language", "en"]),
    ).toThrow(/mutually exclusive/);
  });

  it.each([
    [["--unknown"], /unknown option/],
    [["--language"], /requires a value/],
    [["--language", "fr"], /unsupported language/],
    [["--suite"], /requires a value/],
    [["--suite", "missing"], /unknown domain suite/],
    [["--k", "0"], /positive integer/],
    [["--k", "1.5"], /positive integer/],
  ])("rejects invalid arguments %#", (args, message) => {
    expect(() => parseCliArgs(args)).toThrow(message);
  });
});

const provenance = {
  publisher: "Searchable contributors",
  sourceTitle: "Searchable documentation",
  sourceUrl: "https://ktjn.github.io/searchable/",
  license: "MIT",
  licenseUrl: "https://github.com/ktjn/searchable/blob/main/LICENSE",
  retrievedAt: "2026-07-13",
  attribution: "Searchable contributors",
  selectionNotes: "Test fixture.",
};

const baselineSuite = {
  schemaVersion: 1,
  id: "en-suite",
  version: "1.0.0",
  language: "en",
  provenance,
  documents: [
    {
      id: "home",
      title: "Home",
      body: "Home page",
      url: "https://example.test/",
    },
  ],
  queries: [{ id: "home", text: "home", judgments: { home: 3 } }],
} satisfies RelevanceSuite;

const domainSuite = {
  schemaVersion: 2,
  id: "searchable-docs",
  version: "1.0.0",
  language: "en",
  provenance,
  review: { status: "draft", method: "Maintainer review." },
  corpus: {
    kind: "generated-index",
    pages: [{ id: "/index.html", title: "Searchable" }],
  },
  queries: [
    {
      id: "home",
      text: "home",
      topic: "setup",
      judgments: { "/index.html": 3 },
      rationales: { "/index.html": "Introduces Searchable." },
    },
  ],
} satisfies DomainRelevanceSuite;

const snapshotSuite = {
  ...domainSuite,
  id: "driving-test",
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
    ],
  },
  queries: [
    {
      id: "eyesight",
      text: "number plate eyesight",
      topic: "setup",
      judgments: { "/eyesight": 3 },
      rationales: { "/eyesight": "States the eyesight requirement." },
    },
  ],
} satisfies DomainRelevanceSuite;

const report: SuiteReport = {
  suiteId: "suite",
  suiteVersion: "1.0.0",
  language: "en",
  k: 5,
  documentCount: 1,
  queryCount: 1,
  provenance,
  metrics: {
    meanReciprocalRank: 1,
    meanPrecisionAtK: 0.2,
    meanRecallAtK: 1,
    meanNdcgAtK: 1,
    zeroResultRate: 0,
  },
  queries: [],
};

function dependencies(): CliDependencies {
  return {
    prepareDomain: vi.fn(async () => undefined),
    loadBaselines: vi.fn(async () => [baselineSuite]),
    loadDomain: vi.fn(async () => domainSuite),
    runSuite: vi.fn(async () => report),
    writeOutput: vi.fn(),
  };
}

describe("main", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps baseline execution independent of the showcase", async () => {
    const target = dependencies();
    await main(["--language", "en", "--json"], target);

    expect(target.prepareDomain).not.toHaveBeenCalled();
    expect(target.loadBaselines).toHaveBeenCalledWith("en");
    expect(target.runSuite).toHaveBeenCalledWith(baselineSuite, 5);
    expect(target.loadDomain).not.toHaveBeenCalled();
    expect(target.writeOutput).toHaveBeenCalledOnce();
  });

  it("prepares and evaluates a selected domain suite", async () => {
    const target = dependencies();
    await main(["--suite", "searchable-docs", "--json"], target);

    expect(target.loadDomain).toHaveBeenCalledWith("searchable-docs");
    expect(target.loadDomain).toHaveBeenCalledBefore(target.prepareDomain);
    expect(target.prepareDomain).toHaveBeenCalledWith(domainSuite);
    expect(target.prepareDomain).toHaveBeenCalledOnce();
    expect(target.runSuite).toHaveBeenCalledWith(domainSuite, 5);
    expect(target.loadBaselines).not.toHaveBeenCalled();
    expect(target.writeOutput).toHaveBeenCalledOnce();
  });

  it("prepares and evaluates a selected snapshot suite", async () => {
    const target = dependencies();
    vi.mocked(target.loadDomain).mockResolvedValue(snapshotSuite);
    await main(["--suite", "govuk-learn-to-drive", "--json"], target);

    expect(target.loadDomain).toHaveBeenCalledWith("govuk-learn-to-drive");
    expect(target.prepareDomain).toHaveBeenCalledWith(snapshotSuite);
    expect(target.runSuite).toHaveBeenCalledWith(snapshotSuite, 5);
  });

  it("prepares the showcase only for generated domain corpora", async () => {
    await defaultCliDependencies.prepareDomain(domainSuite);
    expect(prepareShowcase).toHaveBeenCalledOnce();

    vi.mocked(prepareShowcase).mockClear();
    await defaultCliDependencies.prepareDomain(snapshotSuite);
    expect(prepareShowcase).not.toHaveBeenCalled();
  });
});
