import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const repositoryRoot = join(import.meta.dirname, "..", "..");
const acronym = ["c", "s", "f"].join("");
const oldSlug = ["client", "search", "framework"].join("-");
const allowed = new Set([
  "docs/superpowers/specs/2026-07-13-searchable-identity-migration-design.md",
  "docs/superpowers/plans/2026-07-13-searchable-identity-migration.md",
]);
const forbidden = [
  new RegExp(oldSlug, "i"),
  new RegExp(`@${acronym}/`, "i"),
  new RegExp(`\\b${acronym}[-_]`, "i"),
  new RegExp(`\\b${acronym}\\b`, "i"),
];

test("tracked files use only the Searchable identity", () => {
  const files = execFileSync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean)
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => !allowed.has(path));

  const violations: string[] = [];
  for (const path of files) {
    const bytes = readFileSync(join(repositoryRoot, path));
    if (bytes.includes(0)) continue;
    const text = bytes.toString("utf8");
    for (const pattern of forbidden) {
      if (pattern.test(text)) violations.push(`${path}: ${pattern.source}`);
    }
  }

  expect(violations).toEqual([]);
});
