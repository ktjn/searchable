import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { SourceDocument } from "./types.js";

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
  return files.sort();
}

/**
 * Reads every .html file under `rootDir` and assigns each a stable id
 * (its sort order) and a URL derived from its path relative to rootDir
 * (e.g. docs/00-overview.html -> /docs/00-overview) — a reasonable
 * static-site convention, overridable later via `<link rel=canonical>`
 * per docs/15-cms-meta-tag-control.md.
 */
export async function discoverHtmlDocuments(
  rootDir: string,
): Promise<SourceDocument[]> {
  const files = await findHtmlFiles(rootDir);
  return Promise.all(
    files.map(async (file, id) => {
      const html = await readFile(file, "utf8");
      const url = `/${relative(rootDir, file).replace(/\.html$/, "")}`;
      return { id, url, html };
    }),
  );
}
