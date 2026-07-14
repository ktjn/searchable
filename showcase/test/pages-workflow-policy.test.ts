import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const repositoryRoot = join(import.meta.dirname, "..", "..");

test("CI grants its jobs only read access to repository contents", () => {
  const workflow = readFileSync(
    join(repositoryRoot, ".github", "workflows", "ci.yml"),
    "utf8",
  );

  expect(workflow).toMatch(/^permissions:\n {2}contents: read$/m);
});

test("docs:check is the exact local gate and includes the full browser suite", () => {
  const pkg = JSON.parse(
    readFileSync(join(repositoryRoot, "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };
  expect(pkg.scripts["docs:check"]).toContain("pnpm test:browser");
});

test("CI runs benchmark browser measurements only after installing Chromium", () => {
  const benchmarkConfig = readFileSync(
    join(repositoryRoot, "packages", "benchmark", "vitest.config.ts"),
    "utf8",
  );
  const benchmarkBrowserConfig = readFileSync(
    join(repositoryRoot, "packages", "benchmark", "vitest.browser.config.ts"),
    "utf8",
  );
  const benchmarkPackage = JSON.parse(
    readFileSync(
      join(repositoryRoot, "packages", "benchmark", "package.json"),
      "utf8",
    ),
  ) as { scripts: Record<string, string> };
  const workflow = readFileSync(
    join(repositoryRoot, ".github", "workflows", "ci.yml"),
    "utf8",
  );
  const browserJob = workflow.slice(workflow.indexOf("  test-browser:"));
  const install = browserJob.indexOf(
    "pnpm exec playwright install --with-deps chromium",
  );
  const benchmarkTest = browserJob.indexOf(
    "pnpm --filter @ktjn/searchable-benchmark test:browser",
  );

  expect(benchmarkConfig).toContain("...configDefaults.exclude");
  expect(benchmarkConfig).toContain("test/browser-measurement.test.ts");
  expect(benchmarkBrowserConfig).toContain("test/browser-measurement.test.ts");
  expect(benchmarkPackage.scripts["test:browser"]).toContain(
    "vitest.browser.config.ts",
  );
  expect(install).toBeGreaterThan(-1);
  expect(benchmarkTest).toBeGreaterThan(install);
});

test("Pages deploys the exact successful CI revision with a manual override", () => {
  const workflow = readFileSync(
    join(repositoryRoot, ".github", "workflows", "deploy-pages.yml"),
    "utf8",
  );

  expect(workflow).toContain("workflow_run:");
  expect(workflow).toContain("workflows: [CI]");
  expect(workflow).toContain("branches: [main]");
  expect(workflow).toContain("workflow_dispatch:");
  expect(workflow).toContain("workflow_run.conclusion == 'success'");
  expect(workflow).toContain("github.event.workflow_run.head_sha");
});

test("Pages builds and validates the static artifact without browser work", () => {
  const workflow = readFileSync(
    join(repositoryRoot, ".github", "workflows", "deploy-pages.yml"),
    "utf8",
  );
  const build = workflow.indexOf("pnpm docs:build");
  const validate = workflow.indexOf("pnpm --filter showcase validate");
  const upload = workflow.indexOf("actions/upload-pages-artifact");

  expect(build).toBeGreaterThan(-1);
  expect(validate).toBeGreaterThan(build);
  expect(upload).toBeGreaterThan(validate);
  expect(workflow).not.toContain("playwright");
  expect(workflow).not.toContain("pnpm docs:check");
  expect(workflow.match(/pnpm test:browser/g) ?? []).toHaveLength(0);
});

test("Pages build can read the repository Pages configuration", () => {
  const workflow = readFileSync(
    join(repositoryRoot, ".github", "workflows", "deploy-pages.yml"),
    "utf8",
  );
  const buildJob = workflow.slice(
    workflow.indexOf("  build:"),
    workflow.indexOf("  deploy:"),
  );

  expect(buildJob).toContain("pages: write");
});
