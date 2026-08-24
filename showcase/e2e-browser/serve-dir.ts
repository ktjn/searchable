import { serveDirectory } from "@ktjn/searchable-fixtures";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
};

/**
 * A real static file server for Playwright browser tests — serves the
 * built showcase/dist over plain HTTP, since browser modules need an actual
 * origin rather than a file URL. Delegates to the shared serveDirectory
 * helper (the showcase adds .css to the content-type map and serves without
 * CORS).
 */
export const serveDir = (rootDir: string) =>
  serveDirectory(rootDir, { contentTypes: CONTENT_TYPES });
