import { serveDirectory } from "@ktjn/searchable-fixtures";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
};

/**
 * A real static file server for Playwright browser tests — serves
 * whatever's in rootDir (built client bundle, worker.js, index shards,
 * and the test harness HTML) over plain HTTP, since ES module workers
 * loaded via `new Worker(url, {type:'module'})` need an actual origin,
 * not a file:// URL. Delegates to @ktjn/searchable-fixtures's
 * serveDirectory with permissive CORS so a test can exercise a
 * genuinely cross-origin fetch succeeding
 * (e.g. allowCrossOriginShards: true against a second serveDir()
 * instance on a different port) rather than every cross-origin
 * scenario failing on CORS regardless of what this library's own code
 * does.
 */
export const serveDir = (rootDir: string) =>
  serveDirectory(rootDir, { contentTypes: CONTENT_TYPES, cors: true });
