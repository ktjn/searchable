import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import { createServer } from "node:http";
import { join } from "node:path";

/**
 * The smallest possible "static host" for the e2e test — proves the
 * client talks to the index over plain HTTP GET, not via direct
 * filesystem access, which is the actual deployment model
 * (docs/concepts/architecture.md#deployment-topology). Node's built-in
 * fetch doesn't support file:// URLs, so a real (if tiny) HTTP server
 * is the honest way to exercise that path, not a shortcut around it.
 */
export async function serveStatic(rootDir: string): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
  /** Every request path served so far, in order -- lets a test assert exactly which shards a query actually fetched. */
  requestedPaths: string[];
}> {
  const requestedPaths: string[] = [];
  const server: Server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
    requestedPaths.push(path);
    readFile(join(rootDir, path))
      .then((data) => {
        res.writeHead(200, { "content-type": "application/json" });
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
    requestedPaths,
  };
}
