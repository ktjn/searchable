import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = join(import.meta.dirname, "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("public community and package documentation exists", () => {
  for (const path of [
    "CONTRIBUTING.md",
    "SECURITY.md",
    ".github/ISSUE_TEMPLATE/bug-report.yml",
    ".github/ISSUE_TEMPLATE/feature-request.yml",
    ".github/ISSUE_TEMPLATE/config.yml",
    ".github/pull_request_template.md",
    "packages/client/README.md",
    "packages/analysis/README.md",
    "packages/format/README.md",
    "docs/project/public-launch-checklist.md",
  ]) {
    expect(() => read(path), path).not.toThrow();
  }
});

test("public docs describe an unpublished preview", () => {
  const docs = [
    read("README.md"),
    read("docs/getting-started/installation.md"),
    read("docs/reference/compatibility.md"),
    read("CHANGELOG.md"),
  ].join("\n");

  expect(docs).toContain("not yet published");
  expect(docs).not.toContain("The published package API is `1.0.0`");
  expect(docs).not.toContain("are published in lockstep at `1.0.0`");
  expect(read("README.md")).not.toContain("pnpm add @ktjn/searchable-client");
  expect(read("docs/getting-started/installation.md")).not.toContain(
    "pnpm add @ktjn/searchable-client",
  );
});

test("public npm manifests are prepared for the planned first release", () => {
  for (const directory of ["client", "analysis", "format"]) {
    const pkg = JSON.parse(read(`packages/${directory}/package.json`)) as {
      version?: string;
      engines?: { node?: string };
      repository?: { url?: string };
    };
    expect(pkg.version, directory).toBe("1.0.0");
    expect(pkg.engines?.node, directory).toBe(">=24");
    expect(pkg.repository?.url, directory).toBe(
      "git+https://github.com/ktjn/searchable.git",
    );
  }
});

test("post-public security gates are recorded", () => {
  const checklist = read("docs/project/public-launch-checklist.md");
  for (const gate of [
    "secret scanning",
    "push protection",
    "private vulnerability reporting",
    "Dependabot security updates",
    "code scanning",
    "main ruleset",
  ]) {
    expect(checklist).toContain(gate);
  }
});
