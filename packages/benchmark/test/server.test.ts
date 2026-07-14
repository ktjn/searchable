import { request } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { serveBenchmark } from "../src/server.js";

const directories: string[] = [];

async function temporaryDirectory(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `${name}-`));
  directories.push(directory);
  return directory;
}

function requestStatus(baseUrl: string, path: string): Promise<number> {
  const base = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        hostname: base.hostname,
        port: base.port,
        path,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

it("serves only the benchmark page, client, and index roots", async () => {
  const indexDirectory = await temporaryDirectory("benchmark-index");
  const clientDirectory = await temporaryDirectory("benchmark-client");
  await mkdir(join(clientDirectory, "chunks"));
  await writeFile(join(indexDirectory, "manifest.json"), '{"ok":true}');
  await writeFile(
    join(clientDirectory, "index.js"),
    "export class SearchClient {}",
  );

  const server = await serveBenchmark({ indexDirectory, clientDirectory });
  try {
    expect(await fetch(server.baseUrl).then((response) => response.text())).toContain(
      "window.searchableBenchmark",
    );
    expect(await fetch(server.indexUrl).then((response) => response.json())).toEqual(
      { ok: true },
    );
    expect(
      await fetch(new URL("client/index.js", server.baseUrl)).then((response) =>
        response.text(),
      ),
    ).toContain("SearchClient");
    expect((await fetch(new URL("missing", server.baseUrl))).status).toBe(404);
    expect(
      await requestStatus(server.baseUrl, "/index/%2e%2e/client/index.js"),
    ).toBe(403);
  } finally {
    await server.close();
    await server.close();
  }
});
