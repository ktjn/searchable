import { cp, readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { SourceDocument } from "@csf/indexer";
import { buildIndex, writeIndex } from "@csf/indexer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "dist");
const searchIndexDir = join(distDir, "search-index");
const assetsDir = join(distDir, "assets");
const clientDist = join(__dirname, "..", "packages", "client", "dist");

/**
 * Skips dist/gallery -- the Stage 2 feature-gallery demos
 * (build-gallery.ts) are deliberately self-contained corpora with
 * their own manifests, not part of the docs search index (docs/archive/roadmaps/github-pages-showcase.md#stage-2--feature-gallery-needs-phases-2-5,
 * "not one shared mega corpus").
 */
async function findHtmlFiles(dir: string, root = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full === join(root, "gallery")) continue;
      files.push(...(await findHtmlFiles(full, root)));
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
  const totalDocs = Object.values(built.manifest.docCount).reduce(
    (sum, n) => sum + n,
    0,
  );
  console.log(`indexed ${totalDocs} page(s) -> ${searchIndexDir}`);

  await cp(clientDist, assetsDir, { recursive: true });
  console.log(`copied @csf/client build -> ${assetsDir}`);
}

main();
