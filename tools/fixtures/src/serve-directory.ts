import { readdir, readFile } from "node:fs/promises";
import type { Server } from "node:http";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";

export interface StaticServer {
  baseUrl: string;
  close(): Promise<void>;
  /** Every request path served so far, in order. */
  requestedPaths: string[];
}

export interface ServeDirectoryOptions {
  /**
   * Extension (lowercased, including the dot) to Content-Type. Files whose
   * extension isn't listed fall back to `defaultContentType`.
   */
  contentTypes?: Record<string, string>;
  /**
   * Content-Type used when no `contentTypes` entry matches. Defaults to
   * `application/octet-stream`.
   */
  defaultContentType?: string;
  /**
   * When true, every served response carries
   * `access-control-allow-origin: *` so a test can exercise a genuinely
   * cross-origin fetch succeeding (e.g. allowCrossOriginShards: true
   * against a second serveDirectory() instance on a different port)
   * rather than every cross-origin scenario failing on CORS regardless of
   * what this library's own code does. Defaults to false.
   */
  cors?: boolean;
}

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
 * The smallest possible "static host" shared by the repo's test suites —
 * pre-discovers every file under `rootDir` at startup and serves only those
 * paths, so a test can assert exactly which shards a query fetched and that
 * a file written after startup is never served. Rejects any request whose
 * decoded path contains a `..` segment with 403. Node's built-in fetch
 * doesn't support file:// URLs, and ES module workers loaded via
 * `new Worker(url, {type:'module'})` need an actual origin, so a real (if
 * tiny) HTTP server is the honest way to exercise that deployment model
 * instead of a shortcut around it
 * (docs/concepts/architecture.md#deployment-topology).
 */
export async function serveDirectory(
  rootDir: string,
  options: ServeDirectoryOptions = {},
): Promise<StaticServer> {
  const contentTypes = options.contentTypes ?? {};
  const defaultContentType =
    options.defaultContentType ?? "application/octet-stream";
  const cors = options.cors ?? false;
  const root = resolve(rootDir);
  const files = await discoverFiles(root);
  const requestedPaths: string[] = [];
  const server: Server = createServer(
    (
      req: import("http").IncomingMessage,
      res: import("http").ServerResponse,
    ) => {
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
      const contentType = contentTypes[extname(filePath)] ?? defaultContentType;
      readFile(filePath)
        .then((data: Buffer) => {
          const headers: Record<string, string> = {
            "content-type": contentType,
          };
          if (cors) headers["access-control-allow-origin"] = "*";
          res.writeHead(200, headers);
          res.end(data);
        })
        .catch(() => {
          res.writeHead(404);
          res.end();
        });
    },
  );

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
