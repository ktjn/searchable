import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  promoteAndRender,
  renderPerformanceBaseline,
} from "../src/render.js";
import { createReportFixture } from "./report-fixture.js";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "searchable-render-"));
  roots.push(root);
  await mkdir(join(root, "docs", "project"), { recursive: true });
  await mkdir(join(root, "benchmark-results", "cms-2k"), { recursive: true });
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("renders the reviewed evidence and interpretation limits", () => {
  const report = createReportFixture();
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
  expect(markdown).toContain(reportSha256);
});

it("promotes one explicit full report and supports rendering the stable input", async () => {
  const root = await temporaryRoot();
  const input = join(root, "candidate.json");
  const bytes = `${JSON.stringify(createReportFixture(), null, 2)}\n`;
  await writeFile(input, bytes);

  const result = await promoteAndRender(input, root);
  expect(await readFile(result.reviewedReportPath, "utf8")).toBe(bytes);
  expect(await readFile(result.markdownPath, "utf8")).toContain(
    createHash("sha256").update(bytes).digest("hex"),
  );
  await expect(promoteAndRender(result.reviewedReportPath, root)).resolves.toEqual(
    result,
  );
});

it("rejects missing, smoke, and unknown-schema input", async () => {
  const root = await temporaryRoot();
  await expect(promoteAndRender(join(root, "missing.json"), root)).rejects.toThrow();
  const smoke = { ...createReportFixture(), run: { ...createReportFixture().run, profile: "smoke" as const } };
  const smokePath = join(root, "smoke.json");
  await writeFile(smokePath, JSON.stringify(smoke));
  await expect(promoteAndRender(smokePath, root)).rejects.toThrow(/cms-2k/);
  const unknownPath = join(root, "unknown.json");
  await writeFile(unknownPath, JSON.stringify({ ...createReportFixture(), schemaVersion: 2 }));
  await expect(promoteAndRender(unknownPath, root)).rejects.toThrow(/schemaVersion/);
});

it("restores both previous stable artifacts when the second promotion fails", async () => {
  const root = await temporaryRoot();
  const reviewed = join(root, "benchmark-results", "cms-2k", "reviewed-baseline.json");
  const markdown = join(root, "docs", "project", "performance-baseline.md");
  await writeFile(reviewed, "previous report");
  await writeFile(markdown, "previous markdown");
  const input = join(root, "candidate.json");
  await writeFile(input, JSON.stringify(createReportFixture()));

  await expect(
    promoteAndRender(input, root, {
      rename: async (from, to) => {
        if (to === markdown && from.includes(".stage-")) throw new Error("second rename failed");
        await rename(from, to);
      },
    }),
  ).rejects.toThrow("second rename failed");
  expect(await readFile(reviewed, "utf8")).toBe("previous report");
  expect(await readFile(markdown, "utf8")).toBe("previous markdown");
});
