import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { isAbsolute, relative, resolve } from "node:path";

export interface BenchmarkServer {
  baseUrl: string;
  indexUrl: string;
  close(): Promise<void>;
}

export interface ServeBenchmarkOptions {
  indexDirectory: string;
  clientDirectory: string;
}

const BENCHMARK_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Searchable benchmark</title></head>
  <body>
    <script type="module">
      import { SearchClient } from "/client/index.js";

      window.searchableBenchmark = {
        async initialize(indexUrl) {
          const started = performance.now();
          this.client = new SearchClient({
            indexUrl,
            worker: false,
            strict: true,
          });
          await this.client.ready();
          return performance.now() - started;
        },
        async search(query, options) {
          const started = performance.now();
          const result = await this.client.search(query, options);
          return { durationMs: performance.now() - started, result };
        },
        heap() {
          const memory = performance.memory;
          return memory && Number.isFinite(memory.usedJSHeapSize)
            ? { status: "available", usedBytes: memory.usedJSHeapSize }
            : { status: "unavailable", reason: "performance.memory unavailable" };
        },
        dispose() {
          this.client?.dispose();
          this.client = undefined;
        },
      };
    </script>
  </body>
</html>
`;

function contentType(path: string): string {
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  return "application/octet-stream";
}

function descendant(root: string, requestedPath: string): string | undefined {
  const candidate = resolve(root, requestedPath);
  const fromRoot = relative(root, candidate);
  if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    return undefined;
  }
  return candidate;
}

export async function serveBenchmark({
  indexDirectory,
  clientDirectory,
}: ServeBenchmarkOptions): Promise<BenchmarkServer> {
  const indexRoot = resolve(indexDirectory);
  const clientRoot = resolve(clientDirectory);
  const sockets = new Set<import("node:net").Socket>();

  const server = createServer(async (request, response) => {
    if (request.method !== "GET") {
      response.writeHead(405).end();
      return;
    }

    const rawPath = (request.url ?? "/").split("?", 1)[0] ?? "/";
    let path: string;
    try {
      path = decodeURIComponent(rawPath);
    } catch {
      response.writeHead(400).end();
      return;
    }

    if (path.split("/").includes("..")) {
      response.writeHead(403).end();
      return;
    }
    if (path === "/") {
      response
        .writeHead(200, { "content-type": "text/html; charset=utf-8" })
        .end(BENCHMARK_HTML);
      return;
    }

    const route = path.startsWith("/client/")
      ? { root: clientRoot, relativePath: path.slice("/client/".length) }
      : path.startsWith("/index/")
        ? { root: indexRoot, relativePath: path.slice("/index/".length) }
        : undefined;
    if (!route) {
      response.writeHead(404).end();
      return;
    }

    const file = descendant(route.root, route.relativePath);
    if (!file) {
      response.writeHead(403).end();
      return;
    }
    try {
      const bytes = await readFile(file);
      response.writeHead(200, { "content-type": contentType(file) }).end(bytes);
    } catch {
      response.writeHead(404).end();
    }
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise<void>((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListening();
    });
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/`;
  let closePromise: Promise<void> | undefined;

  return {
    baseUrl,
    indexUrl: new URL("index/manifest.json", baseUrl).href,
    close() {
      closePromise ??= new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
        for (const socket of sockets) socket.destroy();
      });
      return closePromise;
    },
  };
}
