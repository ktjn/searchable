import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSite } from "./site-validation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = process.argv[2] ?? join(__dirname, "dist");
const issues = await validateSite(distDir);

if (issues.length > 0) {
  for (const issue of issues) {
    console.error(`${issue.source}: ${issue.reference} (${issue.reason})`);
  }
  process.exitCode = 1;
} else {
  console.log(
    "validated generated site: all local links, assets, and fragments resolve",
  );
}
