import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { serveDir } from "../e2e-browser/serve-dir.js";
import { serveStatic } from "./static-server.js";

function rawGet(
  baseUrl: string,
  path: string,
): Promise<{ status: number; body: string }> {
  const base = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: base.hostname,
        port: base.port,
        path,
        method: "GET",
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe.each([
  ["unit-test server", serveStatic],
  ["browser-test server", serveDir],
])("%s", (_name, startServer) => {
  test("rejects encoded traversal outside its root", async () => {
    const parent = await mkdtemp(join(tmpdir(), "searchable-server-test-"));
    const root = join(parent, "public");
    await mkdir(root);
    await writeFile(join(parent, "secret.txt"), "not public", "utf8");
    const server = await startServer(root);

    try {
      const response = await rawGet(server.baseUrl, "/%2e%2e/secret.txt");
      expect(response.status).toBe(403);
      expect(response.body).not.toContain("not public");
    } finally {
      await server.close();
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("serves only files discovered at startup", async () => {
    const parent = await mkdtemp(join(tmpdir(), "searchable-server-test-"));
    const root = join(parent, "public");
    await mkdir(root);
    const server = await startServer(root);

    try {
      await writeFile(join(root, "late.json"), "not allowlisted", "utf8");
      const response = await rawGet(server.baseUrl, "/late.json");
      expect(response.status).toBe(404);
      expect(response.body).not.toContain("not allowlisted");
    } finally {
      await server.close();
      await rm(parent, { recursive: true, force: true });
    }
  });
});
