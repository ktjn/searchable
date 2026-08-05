import { readdir } from "node:fs/promises";
import { join } from "node:path";

export interface WalkFilesOptions {
  /** If set, only files whose name ends with one of these suffixes are returned. */
  extensions?: string[];
  /** Directories to skip, keyed by absolute path (return true to skip). */
  skipDirectories?: (absoluteDir: string) => boolean;
}

/**
 * Recursively lists files under `root` (unsorted). Shared by the showcase
 * build/validation scripts that each previously re-declared their own
 * walker (build-search.ts, site-validation.ts).
 */
export async function walkFiles(
  root: string,
  options: WalkFilesOptions = {},
): Promise<string[]> {
  const files: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!options.skipDirectories?.(full)) await visit(full);
      } else if (entry.isFile()) {
        if (
          !options.extensions ||
          options.extensions.some((ext) => entry.name.endsWith(ext))
        ) {
          files.push(full);
        }
      }
    }
  }

  await visit(root);
  return files;
}
