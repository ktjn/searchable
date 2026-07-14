import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { promoteAndRender } from "./render.js";

async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length !== 1) {
    throw new Error("usage: render-cli.js <explicit-report-path>");
  }
  const repositoryRoot = resolve(
    fileURLToPath(new URL("../../..", import.meta.url)),
  );
  const result = await promoteAndRender(
    resolve(arguments_[0] as string),
    repositoryRoot,
  );
  console.log(`Reviewed report: ${result.reviewedReportPath}`);
  console.log(`Markdown: ${result.markdownPath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
