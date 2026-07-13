import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

export interface StaticServer {
  baseUrl: string;
  close(): Promise<void>;
}

export async function serveDirectory(
  rootDirectory: string,
): Promise<StaticServer> {
  const root = resolve(rootDirectory);
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(
        new URL(request.url ?? "/", "http://local").pathname,
      );
      const relativePath =
        pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const path = resolve(root, relativePath);
      if (path !== root && !path.startsWith(`${root}${sep}`)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      const bytes = await readFile(path);
      response.setHeader(
        "content-type",
        extname(path) === ".json"
          ? "application/json"
          : "application/octet-stream",
      );
      response.writeHead(200).end(bytes);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        response.writeHead(404).end("Not found");
      } else {
        response.writeHead(500).end("Internal error");
      }
    }
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Static server did not bind a TCP port");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
      }),
  };
}
