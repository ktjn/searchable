import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

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
 * not a file:// URL.
 */
export async function serveDir(
  rootDir: string,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const root = resolve(rootDir);
  const server: Server = createServer((req, res) => {
    const requestPath = decodeURIComponent(
      (req.url ?? "/").split("?")[0] ?? "/",
    );
    const path = resolve(root, requestPath.replace(/^[/\\]+/, ""));
    if (path !== root && !path.startsWith(`${root}${sep}`)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const contentType =
      CONTENT_TYPES[extname(path)] ?? "application/octet-stream";
    readFile(path)
      .then((data) => {
        // Permissive CORS so a test can exercise a genuinely cross-origin
        // fetch succeeding (e.g. allowCrossOriginShards: true against a
        // second serveDir() instance on a different port) rather than
        // every cross-origin scenario failing on CORS regardless of what
        // this library's own code does.
        res.writeHead(200, {
          "content-type": contentType,
          "access-control-allow-origin": "*",
        });
        res.end(data);
      })
      .catch(() => {
        res.writeHead(404);
        res.end();
      });
  });

  await new Promise<void>((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("failed to bind static server");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
