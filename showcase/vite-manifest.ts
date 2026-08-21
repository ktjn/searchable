import { readFile } from "node:fs/promises";
import { join } from "node:path";

interface ViteManifestEntry {
  file: string;
  isEntry?: boolean;
  name?: string;
}

type ViteManifest = Record<string, ViteManifestEntry>;

/**
 * Resolves a `vite.widget.config.ts` entry's real, content-hashed output
 * filename (e.g. "search-widget-D3f9a1Cq.js") from the manifest that
 * build runs writes to `dist/.vite/manifest.json` -- so every
 * page-rendering script (build-docs.ts, build-gallery*.ts) references the
 * actual deployed asset instead of a hardcoded name, which is what makes
 * a redeploy force a fresh fetch instead of serving a stale cached copy.
 * `build:widget` must have already run against `distDir` (see this
 * package's "build" script order) or this throws.
 */
export async function resolveWidgetScript(
  distDir: string,
  entryName: "search-widget" | "gallery-widget",
): Promise<string> {
  const manifestPath = join(distDir, ".vite", "manifest.json");
  const manifest: ViteManifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  );
  const entry = Object.values(manifest).find(
    (candidate) => candidate.isEntry && candidate.name === entryName,
  );
  if (!entry) {
    throw new Error(
      `${manifestPath} has no entry named "${entryName}" -- did build:widget run first?`,
    );
  }
  return entry.file;
}
