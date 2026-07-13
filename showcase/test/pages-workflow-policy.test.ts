import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const repositoryRoot = join(import.meta.dirname, "..", "..");

test("docs:check is the exact local gate and includes the full browser suite", () => {
  const pkg = JSON.parse(
    readFileSync(join(repositoryRoot, "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };
  expect(pkg.scripts["docs:check"]).toContain("pnpm test:browser");
});

test("Pages installs Chromium before the single docs gate and uploads afterward", () => {
  const workflow = readFileSync(
    join(repositoryRoot, ".github", "workflows", "deploy-pages.yml"),
    "utf8",
  );
  const install = workflow.indexOf(
    "pnpm exec playwright install --with-deps chromium",
  );
  const gate = workflow.indexOf("pnpm docs:check");
  const upload = workflow.indexOf("actions/upload-pages-artifact");

  expect(install).toBeGreaterThan(-1);
  expect(gate).toBeGreaterThan(install);
  expect(upload).toBeGreaterThan(gate);
  expect(workflow.match(/pnpm test:browser/g) ?? []).toHaveLength(0);
});
