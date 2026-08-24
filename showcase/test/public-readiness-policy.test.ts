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
    "packages/searchable/README.md",
    "docs/project/public-launch-checklist.md",
  ]) {
    expect(() => read(path), path).not.toThrow();
  }
});

test("public docs describe the published package surface", () => {
  const docs = [
    read("README.md"),
    read("docs/getting-started/installation.md"),
    read("docs/reference/compatibility.md"),
    read("CHANGELOG.md"),
  ].join("\n");

  expect(docs).toContain("published to GitHub Packages");
  expect(docs).toContain("published to PyPI");
  expect(docs).not.toContain("not yet published");
  expect(read("README.md")).toContain("uv add searchable");
});

test("public API references do not advertise removed 1.x surfaces", () => {
  const typescriptReference = read("docs/reference/client-api.md");
  for (const removed of [
    "searchStream",
    "SearchStreamOptions",
    'on("query"',
    'on("result"',
    'mode: "lexical"',
    "validateManifest",
  ]) {
    expect(typescriptReference, removed).not.toContain(removed);
  }

  const pythonReference = read("docs/reference/python-client-api.md");
  expect(pythonReference).not.toContain("from searchable.search");
  expect(pythonReference).not.toContain('`mode`: `"lexical"`');
  expect(pythonReference).toContain("searchable build");
  expect(pythonReference).toContain("searchable query");
  expect(pythonReference).toContain("searchable facet");
});

test("current project policies name only consolidated packages", () => {
  const currentPolicies = [
    read("CONTRIBUTING.md"),
    read("SECURITY.md"),
    read("packages/searchable/README.md"),
  ].join("\n");

  for (const retiredPackage of [
    "@ktjn/searchable-client",
    "@ktjn/searchable-format",
    "@ktjn/searchable-analysis",
    "searchable-binary",
    "python/searchable-indexer",
    "python/searchable-analysis",
  ]) {
    expect(currentPolicies, retiredPackage).not.toContain(retiredPackage);
  }
});

test("public npm manifests use the current patch release", () => {
  for (const directory of ["searchable"]) {
    const pkg = JSON.parse(read(`packages/${directory}/package.json`)) as {
      version?: string;
      engines?: { node?: string };
      repository?: { url?: string };
    };
    expect(pkg.version, directory).toBe("2.0.1");
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
