import { readdir, readFile } from "node:fs/promises";
import type { Server } from "node:http";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
};

async function discoverFiles(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  async function visit(directory: string, route: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filePath = join(directory, entry.name);
      const fileRoute = `${route}/${entry.name}`;
      if (entry.isDirectory()) await visit(filePath, fileRoute);
      else if (entry.isFile()) files.set(fileRoute, filePath);
    }
  }
  await visit(root, "");
  return files;
}

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
  const root = resolve(rootDir);
  const files = await discoverFiles(root);
  const server: Server = createServer((req, res) => {
    const requestPath = decodeURIComponent(
      (req.url ?? "/").split("?")[0] ?? "/",
    ).replaceAll("\\", "/");
    if (requestPath.split("/").includes("..")) {
      res.writeHead(403);
      res.end();
      return;
    }
    const filePath = files.get(requestPath);
    if (!filePath) {
      res.writeHead(404);
      res.end();
      return;
    }
    const contentType =
      CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream";
    readFile(filePath)
      .then((data) => {
        res.writeHead(200, { "content-type": contentType });
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
