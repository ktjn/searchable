import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DomainRelevanceSuite } from "../src/domain-schema.js";
import { normalizeGovukDocument } from "../src/govuk-normalize.js";
import {
  compareSnapshot,
  extractJourneyRoutes,
  GOVUK_EXPECTED_ROUTES,
  GOVUK_JOURNEY_PATH,
  refreshGovukSuite,
} from "../src/govuk-refresh.js";

const EXPECTED_ROUTES = [
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

const EXTERNAL_APP = "https://onelink.to/858uyu";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function hub(hrefs: unknown[] = [...EXPECTED_ROUTES.slice(1), EXTERNAL_APP]) {
  return {
    schema_name: "step_by_step_nav",
    base_path: GOVUK_JOURNEY_PATH,
    title: "Learn to drive a car: step by step",
    description: "Check what you need to do to learn to drive.",
    details: {
      step_by_step_nav: {
        introduction: "<p>Learn to drive step by step.</p>",
        steps: [
          {
            title: "Journey",
            contents: [
              {
                type: "paragraph",
                text: "<p>Follow these steps.</p>",
              },
              {
                type: "list",
                contents: hrefs.map((href) => ({
                  href,
                  text: typeof href === "string" ? `Visit ${href}` : "Visit",
                })),
              },
            ],
          },
        ],
      },
    },
  };
}

function answer(route: string, body = `Current content for ${route}`) {
  return {
    schema_name: "answer",
    base_path: route,
    title: `Title for ${route}`,
    description: `Description for ${route}`,
    details: { body: `<p>${body}</p>` },
  };
}

function contentItems(): Map<string, unknown> {
  return new Map([
    [GOVUK_JOURNEY_PATH, hub()],
    ...EXPECTED_ROUTES.slice(1).map((route) => [route, answer(route)] as const),
  ]);
}

function response(
  route: string,
  value: unknown,
  overrides: Partial<{
    ok: boolean;
    status: number;
    url: string;
    contentType: string;
  }> = {},
) {
  return {
    ok: overrides.ok ?? true,
    status: overrides.status ?? 200,
    url: overrides.url ?? `https://www.gov.uk/api/content${route}`,
    headers: new Headers({
      "content-type":
        overrides.contentType ?? "application/json; charset=utf-8",
    }),
    json: async () => structuredClone(value),
  } as Response;
}

function fakeFetch(
  items = contentItems(),
  transform?: (route: string, value: unknown) => Response,
): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    const route = url.pathname.slice("/api/content".length);
    const value = items.get(route);
    if (!value) return response(route, {}, { ok: false, status: 404 });
    return transform?.(route, value) ?? response(route, value);
  }) as typeof fetch;
}

const provenance = {
  publisher: "Government Digital Service and GOV.UK publishing organisations",
  sourceTitle: "Learn to drive a car: step by step",
  sourceUrl: "https://www.gov.uk/learn-to-drive-a-car",
  license: "Open Government Licence v3.0",
  licenseUrl:
    "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
  retrievedAt: "2026-07-12",
  attribution:
    "Contains public sector information licensed under the Open Government Licence v3.0.",
  selectionNotes:
    "The journey hub and its 21 internal GOV.UK destinations are included. The external theory-test application and neighboring pages are excluded. Searchable text is normalized from the GOV.UK Content API.",
};

function suite(documents = normalizedDocuments()): DomainRelevanceSuite {
  return {
    schemaVersion: 2,
    id: "govuk-learn-to-drive",
    version: "1.0.0",
    language: "en",
    provenance,
    review: { status: "draft", method: "Maintainer review." },
    corpus: { kind: "snapshot", documents },
    queries: [
      {
        id: "eyesight",
        text: "eyesight test number plate",
        topic: "setup",
        judgments: { "/driving-eyesight-rules": 3 },
        rationales: {
          "/driving-eyesight-rules": "States the eyesight requirement.",
        },
      },
    ],
  };
}

function normalizedDocuments() {
  const items = contentItems();
  return EXPECTED_ROUTES.map((route) =>
    normalizeGovukDocument(route, items.get(route)),
  );
}

async function fixture(value: unknown): Promise<{
  directory: string;
  path: string;
  original: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "searchable-govuk-refresh-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "govuk-learn-to-drive.json");
  const original = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path, original, "utf8");
  return { directory, path, original };
}

describe("GOV.UK journey inventory", () => {
  it("uses the exact approved 22-route journey", () => {
    expect(GOVUK_EXPECTED_ROUTES).toEqual(EXPECTED_ROUTES);
    expect(extractJourneyRoutes(hub())).toEqual(EXPECTED_ROUTES.slice(1));
  });

  it.each([
    [
      "duplicate internal routes",
      [...EXPECTED_ROUTES.slice(1), EXPECTED_ROUTES[1], EXTERNAL_APP],
      /duplicate journey route/,
    ],
    [
      "non-string hrefs",
      [...EXPECTED_ROUTES.slice(1), 42, EXTERNAL_APP],
      /href must be a string/,
    ],
    [
      "different internal route",
      [...EXPECTED_ROUTES.slice(1, -1), "/different", EXTERNAL_APP],
      /journey route inventory differs/,
    ],
    [
      "missing approved route",
      [...EXPECTED_ROUTES.slice(1, -1), EXTERNAL_APP],
      /journey route inventory differs/,
    ],
    [
      "extra external destination",
      [...EXPECTED_ROUTES.slice(1), EXTERNAL_APP, "https://example.test/app"],
      /exactly one approved external destination/,
    ],
  ])("rejects %s", (_name, hrefs, message) => {
    expect(() => extractJourneyRoutes(hub(hrefs))).toThrow(message);
  });

  it("rejects a non-step-by-step hub", () => {
    expect(() =>
      extractJourneyRoutes({ ...hub(), schema_name: "guide" }),
    ).toThrow(/hub schema must be step_by_step_nav/);
  });
});

describe("compareSnapshot", () => {
  it("sorts added, removed, and content-changed routes", () => {
    const current = normalizedDocuments().slice(0, 2);
    const next = normalizedDocuments().slice(1, 3);
    next[0] = { ...next[0], contentHash: "f".repeat(64) };
    expect(compareSnapshot(current, next)).toEqual({
      addedRoutes: [EXPECTED_ROUTES[2]],
      removedRoutes: [EXPECTED_ROUTES[0]],
      changedRoutes: [EXPECTED_ROUTES[1]],
    });
  });
});

describe("refreshGovukSuite", () => {
  it("reports check drift without writing", async () => {
    const current = suite();
    if (current.corpus.kind !== "snapshot") throw new Error("unreachable");
    const index = current.corpus.documents.findIndex(
      ({ id }) => id === "/driving-eyesight-rules",
    );
    current.corpus.documents[index] = {
      ...current.corpus.documents[index],
      body: "Old content",
      contentHash: "0".repeat(64),
    };
    const target = await fixture(current);

    const checked = await refreshGovukSuite({
      mode: "check",
      fixturePath: target.path,
      fetch: fakeFetch(),
    });

    expect(checked).toEqual({
      addedRoutes: [],
      removedRoutes: [],
      changedRoutes: ["/driving-eyesight-rules"],
    });
    expect(await readFile(target.path, "utf8")).toBe(target.original);
  });

  it("writes a complete draft atomically without changing judgments", async () => {
    const seed = suite([]);
    seed.version = "0.0.0";
    const queryJson = JSON.stringify(seed.queries);
    const target = await fixture(seed);

    const result = await refreshGovukSuite({
      mode: "write",
      fixturePath: target.path,
      fetch: fakeFetch(),
      version: "1.0.0",
      sourceCreditAudit: true,
      now: () => new Date("2026-07-13T12:00:00Z"),
    });
    const updated = JSON.parse(await readFile(target.path, "utf8"));

    expect(result.addedRoutes).toEqual([...EXPECTED_ROUTES].sort());
    expect(updated.version).toBe("1.0.0");
    expect(updated.provenance.retrievedAt).toBe("2026-07-13");
    expect(updated.corpus.documents).toHaveLength(22);
    expect(updated.review).toEqual({
      status: "draft",
      method:
        "Maintainer review of every normalized document, query, grade, rationale, and measured top-five result.",
    });
    expect(JSON.stringify(updated.queries)).toBe(queryJson);
  });

  it.each([
    ["missing source-credit audit", { version: "1.1.0" }, /sourceCreditAudit/],
    ["missing version", { sourceCreditAudit: true }, /version is required/],
    [
      "invalid semantic version",
      { version: "next", sourceCreditAudit: true },
      /semantic version/,
    ],
    [
      "non-incremented version",
      { version: "1.0.0", sourceCreditAudit: true },
      /greater than committed version/,
    ],
  ])("does not modify the fixture for %s", async (_name, options, message) => {
    const target = await fixture(suite());
    await expect(
      refreshGovukSuite({
        mode: "write",
        fixturePath: target.path,
        fetch: fakeFetch(),
        ...options,
      }),
    ).rejects.toThrow(message);
    expect(await readFile(target.path, "utf8")).toBe(target.original);
  });

  it("rejects malformed exact OGL provenance before fetching", async () => {
    const value = suite();
    value.provenance = { ...value.provenance, license: "OGL" };
    const target = await fixture(value);
    const fetcher = fakeFetch();
    await expect(
      refreshGovukSuite({
        mode: "check",
        fixturePath: target.path,
        fetch: fetcher,
      }),
    ).rejects.toThrow(/exact GOV\.UK OGL provenance/);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await readFile(target.path, "utf8")).toBe(target.original);
  });

  it.each([
    [
      "malformed payload",
      (items: Map<string, unknown>) =>
        items.set("/vehicles-can-drive", {
          ...answer("/vehicles-can-drive"),
          title: 42,
        }),
      /item\.title must be a string/,
    ],
    [
      "unknown schema",
      (items: Map<string, unknown>) =>
        items.set("/vehicles-can-drive", {
          ...answer("/vehicles-can-drive"),
          schema_name: "unknown",
        }),
      /unsupported GOV\.UK schema unknown/,
    ],
  ])("does not modify the fixture after %s", async (_name, mutate, message) => {
    const target = await fixture(suite());
    const items = contentItems();
    mutate(items);
    await expect(
      refreshGovukSuite({
        mode: "check",
        fixturePath: target.path,
        fetch: fakeFetch(items),
      }),
    ).rejects.toThrow(message);
    expect(await readFile(target.path, "utf8")).toBe(target.original);
  });

  it.each([
    [
      "a malformed committed content hash",
      (value: DomainRelevanceSuite) => {
        if (value.corpus.kind !== "snapshot") throw new Error("unreachable");
        value.corpus.documents[0].contentHash = "bad";
      },
      /contentHash must be a lowercase SHA-256 hash/,
    ],
    [
      "a duplicate committed route",
      (value: DomainRelevanceSuite) => {
        if (value.corpus.kind !== "snapshot") throw new Error("unreachable");
        value.corpus.documents.push({ ...value.corpus.documents[0] });
      },
      /duplicate document id/,
    ],
  ])("rejects %s before fetching", async (_name, mutate, message) => {
    const value = suite();
    mutate(value);
    const target = await fixture(value);
    const fetcher = fakeFetch();
    await expect(
      refreshGovukSuite({
        mode: "check",
        fixturePath: target.path,
        fetch: fetcher,
      }),
    ).rejects.toThrow(message);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await readFile(target.path, "utf8")).toBe(target.original);
  });

  it.each([
    [
      "HTTP 404",
      (route: string, value: unknown) =>
        response(route, value, { ok: false, status: 404 }),
      /HTTP 404/,
    ],
    [
      "HTTP failure",
      (route: string, value: unknown) =>
        response(route, value, { ok: false, status: 500 }),
      /HTTP 500/,
    ],
    [
      "non-JSON response",
      (route: string, value: unknown) =>
        response(route, value, { contentType: "text/html" }),
      /must return JSON/,
    ],
    [
      "external redirect",
      (route: string, value: unknown) =>
        response(route, value, {
          url: `https://example.test/api/content${route}`,
        }),
      /redirected outside GOV\.UK Content API/,
    ],
  ])(
    "does not modify the fixture after %s",
    async (_name, transform, message) => {
      const target = await fixture(suite());
      await expect(
        refreshGovukSuite({
          mode: "check",
          fixturePath: target.path,
          fetch: fakeFetch(contentItems(), transform),
        }),
      ).rejects.toThrow(message);
      expect(await readFile(target.path, "utf8")).toBe(target.original);
    },
  );

  it("removes the temporary sibling if atomic rename fails", async () => {
    const target = await fixture(suite());
    const rename = vi.fn(async () => {
      throw new Error("rename failed");
    });
    await expect(
      refreshGovukSuite({
        mode: "write",
        fixturePath: target.path,
        fetch: fakeFetch(),
        version: "1.1.0",
        sourceCreditAudit: true,
        rename,
      }),
    ).rejects.toThrow(/rename failed/);
    expect(await readFile(target.path, "utf8")).toBe(target.original);
    expect(
      (await import("node:fs/promises")).readdir(target.directory),
    ).resolves.toEqual(["govuk-learn-to-drive.json"]);
  });
});
