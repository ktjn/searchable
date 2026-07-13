import { readdir, readFile } from "node:fs/promises";
import type { Server } from "node:http";
import { createServer } from "node:http";
import { join, resolve } from "node:path";

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
  const root = resolve(rootDir);
  const files = await discoverFiles(root);
  const requestedPaths: string[] = [];
  const server: Server = createServer((req, res) => {
    const requestPath = decodeURIComponent(
      (req.url ?? "/").split("?")[0] ?? "/",
    ).replaceAll("\\", "/");
    requestedPaths.push(requestPath);
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
    readFile(filePath)
      .then((data) => {
        res.writeHead(200, { "content-type": "application/json" });
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
    requestedPaths,
  };
}
