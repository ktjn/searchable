import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { promoteAndRender, renderPerformanceBaseline } from "../src/render.js";
import type { BenchmarkReportV1 } from "../src/types.js";
import { hashCanonical } from "../src/workload.js";
import { createReportFixture } from "./report-fixture.js";

const roots: string[] = [];
const reviewedFixturePath = fileURLToPath(
  new URL(
    "../../../benchmark-results/cms-2k/reviewed-baseline.json",
    import.meta.url,
  ),
);

async function canonicalReportBytes(): Promise<Buffer> {
  return readFile(reviewedFixturePath);
}

async function canonicalReport(): Promise<BenchmarkReportV1> {
  return JSON.parse((await canonicalReportBytes()).toString("utf8"));
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "searchable-render-"));
  roots.push(root);
  await mkdir(join(root, "docs", "project"), { recursive: true });
  await mkdir(join(root, "benchmark-results", "cms-2k"), { recursive: true });
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("renders the reviewed evidence and interpretation limits", () => {
  const report = createReportFixture();
  report.environment.cpuModel = "  Test CPU  ";
  const reportSha256 = "b".repeat(64);
  const markdown = renderPerformanceBaseline(report, reportSha256);
  expect(markdown).toContain("# Performance baseline");
  expect(markdown).toContain("CMS-2k Chromium vertical baseline");
  expect(markdown).toContain("2 measured repetitions");
  expect(markdown).toContain("p50");
  expect(markdown).toContain("p95");
  expect(markdown).toContain("gzip-equivalent");
  expect(markdown).toContain("not a performance budget");
  expect(markdown).toContain("not a supported operating range");
  expect(markdown).toContain("reviewed-baseline.json");
  expect(markdown).toContain("multiple corpus sizes");
  expect(markdown).toContain("- CPU: Test CPU, 8 logical CPUs");
  expect(markdown).toContain(reportSha256);
});

it("promotes one explicit full report and supports rendering the stable input", async () => {
  const root = await temporaryRoot();
  const input = join(root, "candidate.json");
  const bytes = await canonicalReportBytes();
  await writeFile(input, bytes);

  const result = await promoteAndRender("candidate.json", root);
  expect(await readFile(result.reviewedReportPath, "utf8")).toBe(
    bytes.toString("utf8"),
  );
  expect(await readFile(result.markdownPath, "utf8")).toContain(
    createHash("sha256").update(bytes).digest("hex"),
  );
  await expect(
    promoteAndRender(result.reviewedReportPath, root),
  ).resolves.toEqual(result);
});

it("rejects missing, smoke, and unknown-schema input", async () => {
  const root = await temporaryRoot();
  await expect(
    promoteAndRender(join(root, "missing.json"), root),
  ).rejects.toThrow();
  const smoke = {
    ...createReportFixture(),
    run: { ...createReportFixture().run, profile: "smoke" as const },
  };
  const smokePath = join(root, "smoke.json");
  await writeFile(smokePath, JSON.stringify(smoke));
  await expect(promoteAndRender(smokePath, root)).rejects.toThrow(/cms-2k/);
  const unknownPath = join(root, "unknown.json");
  await writeFile(
    unknownPath,
    JSON.stringify({ ...createReportFixture(), schemaVersion: 2 }),
  );
  await expect(promoteAndRender(unknownPath, root)).rejects.toThrow(
    /schemaVersion/,
  );

  const altered = await canonicalReport();
  const firstDefinition = altered.queries.definitions[0];
  if (!firstDefinition)
    throw new Error("canonical report must contain a query");
  firstDefinition.expected.totalHits = 1;
  const { sha256: _oldHash, ...alteredQuery } = firstDefinition;
  firstDefinition.sha256 = hashCanonical(alteredQuery);
  altered.queries.sha256 = hashCanonical(
    altered.queries.definitions.map(({ sha256: _hash, ...query }) => query),
  );
  const alteredPath = join(root, "altered.json");
  await writeFile(alteredPath, JSON.stringify(altered));
  await expect(promoteAndRender(alteredPath, root)).rejects.toThrow(
    /canonical CMS-2k/,
  );
});

it("preserves a recoverable backup when rollback restoration fails", async () => {
  const root = await temporaryRoot();
  const reviewed = join(
    root,
    "benchmark-results",
    "cms-2k",
    "reviewed-baseline.json",
  );
  const markdown = join(root, "docs", "project", "performance-baseline.md");
  await writeFile(reviewed, "previous report");
  await writeFile(markdown, "previous markdown");
  const input = join(root, "candidate.json");
  await writeFile(input, await canonicalReportBytes());

  await expect(
    promoteAndRender(input, root, {
      rename: async (from, to) => {
        if (to === markdown && from.includes(".stage-"))
          throw new Error("promotion failed");
        if (to === reviewed && from.includes(".backup-"))
          throw new Error("restore failed");
        await rename(from, to);
      },
    }),
  ).rejects.toThrow(/rollback failed/);
  const recoverable = (await readdir(dirname(reviewed))).filter((name) =>
    name.includes("reviewed-baseline.json.backup-"),
  );
  expect(recoverable).toHaveLength(1);
  const backup = recoverable[0];
  if (!backup) throw new Error("recoverable backup must exist");
  expect(await readFile(join(dirname(reviewed), backup), "utf8")).toBe(
    "previous report",
  );
});

it("restores both previous stable artifacts when the second promotion fails", async () => {
  const root = await temporaryRoot();
  const reviewed = join(
    root,
    "benchmark-results",
    "cms-2k",
    "reviewed-baseline.json",
  );
  const markdown = join(root, "docs", "project", "performance-baseline.md");
  await writeFile(reviewed, "previous report");
  await writeFile(markdown, "previous markdown");
  const input = join(root, "candidate.json");
  await writeFile(input, await canonicalReportBytes());

  await expect(
    promoteAndRender(input, root, {
      rename: async (from, to) => {
        if (to === markdown && from.includes(".stage-"))
          throw new Error("second rename failed");
        await rename(from, to);
      },
    }),
  ).rejects.toThrow("second rename failed");
  expect(await readFile(reviewed, "utf8")).toBe("previous report");
  expect(await readFile(markdown, "utf8")).toBe("previous markdown");
});
