import { cp, readFile, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex, writeIndex } from "@csf/indexer";
import type { SourceDocument } from "@csf/indexer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "dist");
const searchIndexDir = join(distDir, "search-index");
const assetsDir = join(distDir, "assets");
const clientDist = join(__dirname, "..", "packages", "client", "dist");

async function findHtmlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findHtmlFiles(full)));
    } else if (entry.name.endsWith(".html")) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Deliberately keeps the .html extension in each doc's url (unlike
 * @csf/indexer's own discoverHtmlDocuments helper, which strips it
 * assuming a host that serves extensionless paths) — every internal
 * link build-docs.ts generates already includes .html explicitly, and
 * a plain static host (GitHub Pages without Jekyll pretty-permalink
 * config) won't resolve the extensionless form, so search results
 * need to match the site's own actual linking convention.
 */
async function discoverRenderedPages(
  rootDir: string,
): Promise<SourceDocument[]> {
  const files = (await findHtmlFiles(rootDir)).sort();
  return Promise.all(
    files.map(async (file, id) => {
      const html = await readFile(file, "utf8");
      const url = `/${relative(rootDir, file)}`;
      return { id, url, html };
    }),
  );
}

async function main() {
  const sources = await discoverRenderedPages(distDir);
  const built = buildIndex(sources);
  await writeIndex(built, searchIndexDir);
  console.log(
    `indexed ${built.manifest.docCount} page(s) -> ${searchIndexDir}`,
  );

  await cp(clientDist, assetsDir, { recursive: true });
  console.log(`copied @csf/client build -> ${assetsDir}`);
}

main();
