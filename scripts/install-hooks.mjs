// Points git at the versioned hooks in .githooks so the pre-push gate runs
// for every clone. Skipped in CI and outside a git checkout.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

if (!process.env.CI && existsSync(".git")) {
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
    stdio: "inherit",
  });
}
