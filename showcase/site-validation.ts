import { readdir, readFile, stat } from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

export interface ValidationIssue {
  source: string;
  reference: string;
  reason: string;
}

const REFERENCE_PATTERN =
  /(?<![\w:-])(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
const ID_PATTERN = /(?<![\w:-])id\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const ROUTE_FIELDS = new Set(["href", "path", "source", "url"]);
const FORBIDDEN_DOC_PATHS = ["docs/archive/", "docs/superpowers/"];

async function listSiteFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  }

  await visit(rootDir);
  return files.sort();
}

function extractMatches(pattern: RegExp, html: string): string[] {
  return Array.from(html.matchAll(pattern), (match) =>
    (match[1] ?? match[2] ?? match[3] ?? "").trim(),
  );
}

function isIgnoredReference(reference: string): boolean {
  return (
    /^(?:https?:|mailto:|data:)/i.test(reference) || reference.startsWith("//")
  );
}

function splitReference(reference: string): { path: string; fragment: string } {
  const hashIndex = reference.indexOf("#");
  const pathAndQuery =
    hashIndex === -1 ? reference : reference.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? "" : reference.slice(hashIndex + 1);
  return {
    path: pathAndQuery.split("?", 1)[0] ?? "",
    fragment,
  };
}

function displayPath(rootDir: string, path: string): string {
  return relative(rootDir, path).split(sep).join("/");
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function containsFragment(
  path: string,
  fragment: string,
): Promise<boolean> {
  if (extname(path).toLowerCase() !== ".html") return true;
  const html = await readFile(path, "utf8");
  const ids = new Set(extractMatches(ID_PATTERN, html));
  try {
    return ids.has(decodeURIComponent(fragment));
  } catch {
    return ids.has(fragment);
  }
}

function forbiddenRouteValues(value: unknown, routeBearing = false): string[] {
  if (typeof value === "string") {
    const normalizedValue = value.replace(/\\/g, "/");
    return routeBearing &&
      FORBIDDEN_DOC_PATHS.some((forbiddenPath) =>
        normalizedValue.includes(forbiddenPath),
      )
      ? [value]
      : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => forbiddenRouteValues(entry, routeBearing));
  }
  if (!value || typeof value !== "object") return [];

  return Object.entries(value).flatMap(([key, entry]) =>
    forbiddenRouteValues(
      entry,
      routeBearing || ROUTE_FIELDS.has(key.toLowerCase()),
    ),
  );
}

export async function validateSite(
  rootDir: string,
): Promise<ValidationIssue[]> {
  const absoluteRoot = resolve(rootDir);
  const issues: ValidationIssue[] = [];
  const siteFiles = await listSiteFiles(absoluteRoot);

  for (const file of siteFiles) {
    const source = displayPath(absoluteRoot, file);
    for (const forbiddenPath of FORBIDDEN_DOC_PATHS) {
      if (source.includes(forbiddenPath)) {
        issues.push({
          source,
          reference: source,
          reason: "forbidden generated path",
        });
        break;
      }
    }

    if (
      extname(file).toLowerCase() === ".json" &&
      source.split("/").includes("search-index")
    ) {
      const json = JSON.parse(await readFile(file, "utf8")) as unknown;
      for (const reference of forbiddenRouteValues(json)) {
        issues.push({
          source,
          reference,
          reason: "forbidden search-index entry",
        });
      }
    }
  }

  for (const sourcePath of siteFiles.filter(
    (file) => extname(file).toLowerCase() === ".html",
  )) {
    const html = await readFile(sourcePath, "utf8");
    for (const reference of extractMatches(REFERENCE_PATTERN, html)) {
      if (!reference || isIgnoredReference(reference)) continue;

      const { path, fragment } = splitReference(reference);
      const targetPath = path.startsWith("/")
        ? resolve(absoluteRoot, `.${path}`)
        : resolve(dirname(sourcePath), path || sourcePath);
      const targetRelativePath = relative(absoluteRoot, targetPath);
      const isInsideArtifact =
        targetRelativePath !== ".." &&
        !targetRelativePath.startsWith(`..${sep}`) &&
        !isAbsolute(targetRelativePath);

      if (!isInsideArtifact || !(await isFile(targetPath))) {
        issues.push({
          source: displayPath(absoluteRoot, sourcePath),
          reference,
          reason: "missing target",
        });
      } else if (fragment && !(await containsFragment(targetPath, fragment))) {
        issues.push({
          source: displayPath(absoluteRoot, sourcePath),
          reference,
          reason: "missing fragment",
        });
      }
    }
  }

  return issues.sort(
    (left, right) =>
      left.source.localeCompare(right.source) ||
      left.reference.localeCompare(right.reference) ||
      left.reason.localeCompare(right.reason),
  );
}
