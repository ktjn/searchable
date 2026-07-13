import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { serveDir } from "../e2e-browser/serve-dir.js";

test("the showcase server rejects encoded traversal outside its root", async () => {
  const parent = await mkdtemp(join(tmpdir(), "searchable-showcase-test-"));
  const root = join(parent, "public");
  await mkdir(root);
  await writeFile(join(parent, "secret.txt"), "not public", "utf8");
  const server = await serveDir(root);

  try {
    const base = new URL(server.baseUrl);
    const response = await new Promise<{ status: number; body: string }>(
      (resolve, reject) => {
        const req = request(
          {
            hostname: base.hostname,
            port: base.port,
            path: "/%2e%2e/secret.txt",
            method: "GET",
          },
          (result) => {
            const chunks: Buffer[] = [];
            result.on("data", (chunk: Buffer) => chunks.push(chunk));
            result.on("end", () =>
              resolve({
                status: result.statusCode ?? 0,
                body: Buffer.concat(chunks).toString("utf8"),
              }),
            );
          },
        );
        req.on("error", reject);
        req.end();
      },
    );
    expect(response.status).toBe(403);
    expect(response.body).not.toContain("not public");
  } finally {
    await server.close();
    await rm(parent, { recursive: true, force: true });
  }
});
