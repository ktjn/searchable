import { serveDirectory } from "@ktjn/searchable-fixtures";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
};

/**
 * A real static file server for Playwright browser tests — serves the
 * built showcase/dist over plain HTTP, since ES module workers loaded
 * via `new Worker(url, {type:'module'})` need an actual origin, not a
 * file:// URL. Delegates to @ktjn/searchable-fixtures's serveDirectory
 * (the showcase adds .css to the content-type map and serves without
 * CORS).
 */
export const serveDir = (rootDir: string) =>
  serveDirectory(rootDir, { contentTypes: CONTENT_TYPES });
