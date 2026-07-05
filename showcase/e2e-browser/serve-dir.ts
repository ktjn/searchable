import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { extname, join } from "node:path";

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
 * file:// URL. (Same shape as packages/client/e2e-browser/serve-dir.ts;
 * duplicated rather than shared since it's ~30 lines and pulling it
 * into its own workspace package for two callers would be more
 * ceremony than the thing it's saving.)
 */
export async function serveDir(
  rootDir: string,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
    const contentType =
      CONTENT_TYPES[extname(path)] ?? "application/octet-stream";
    readFile(join(rootDir, path))
      .then((data) => {
        res.writeHead(200, { "content-type": contentType });
        res.end(data);
      })
      .catch(() => {
        res.writeHead(404);
        res.end();
      });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("failed to bind static server");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
