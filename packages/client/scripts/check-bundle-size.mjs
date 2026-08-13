#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

/**
 * Bundle-size CI gate for @ktjn/searchable-client (docs/project/governance.md#performance-policy,
 * docs/project/roadmap.md Phase 6). Checks the entry points a consumer
 * actually loads -- the main-thread bundle and the opt-in offline
 * Service Worker bundle -- against a fixed
 * gzipped-size budget, so a dependency creep or an
 * accidentally-unshaken import shows up as a failing CI check, not a
 * bundle-size regression nobody notices until a user complains.
 *
 * Scoped to today's reality, not the full per-plugin table in
 * docs/reference/client-api.md: @ktjn/searchable-client ships as one bundle with facets/pins/synonyms/
 * fuzzy already baked in (no plugin:fuzzy/plugin:synonyms split to
 * gate independently yet), so this checks the real artifacts against
 * one "core" budget rather than gating plugins that don't exist as
 * separate entry points. Revisit once a plugin architecture ships.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "..", "dist");

const BUDGET_BYTES = 15 * 1024; // 15 KB gzipped, matching the "@ktjn/searchable-client core" row in docs/reference/client-api.md

const ARTIFACTS = ["index.js", "sw.js"];

let failed = false;
for (const name of ARTIFACTS) {
  const path = join(distDir, name);
  const raw = readFileSync(path);
  const gzipped = gzipSync(raw, { level: 9 });
  const overBudget = gzipped.length > BUDGET_BYTES;
  failed ||= overBudget;
  const status = overBudget ? "FAIL" : "ok";
  console.log(
    `[bundle-size] ${name}: ${gzipped.length} B gzip (budget ${BUDGET_BYTES} B) -- ${status}`,
  );
}

if (failed) {
  console.error(
    "[bundle-size] one or more @ktjn/searchable-client artifacts exceeded their budget",
  );
  process.exit(1);
}
