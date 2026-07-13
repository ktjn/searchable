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
