import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { measureBrowser } from "../src/browser-measurement.js";
import { SMOKE_CONFIG } from "../src/config.js";
import { measureIndex } from "../src/index-measurement.js";
import type { BenchmarkServer } from "../src/server.js";
import { serveBenchmark } from "../src/server.js";
import type { ArtifactMeasurement, BenchmarkQuery } from "../src/types.js";
import { createWorkload } from "../src/workload.js";

describe("Chromium browser measurement", () => {
  let directory: string;
  let server: BenchmarkServer;
  let artifacts: ArtifactMeasurement[];
  const workload = createWorkload(SMOKE_CONFIG);
  const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "searchable-browser-benchmark-"));
    const index = await measureIndex(workload.documents, 0, directory);
    artifacts = index.artifacts;
    server = await serveBenchmark({
      indexDirectory: directory,
      clientDirectory: join(repositoryRoot, "packages", "client", "dist"),
    });
  });

  afterAll(async () => {
    await server?.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("measures correctness-checked cold and warm smoke runs", async () => {
    const result = await measureBrowser({
      config: SMOKE_CONFIG,
      queries: workload.queries,
      server,
      artifacts,
    });

    expect(result.browser.name).toBe("chromium");
    expect(result.browser.version).toMatch(/\d+/);
    expect(result.cold).toHaveLength(6);
    for (const query of result.cold) {
      expect(query.initialize.samples).toHaveLength(2);
      expect(query.firstQuery.samples).toHaveLength(2);
      expect(query.combined.samples).toHaveLength(2);
      expect(query.transfers).toHaveLength(2);
    }
    expect(result.warm.wholePass.samples).toHaveLength(2);
    expect(result.warm.indexRequestCount).toBe(0);
    expect(result.warm.queries).toHaveLength(6);
  }, 60_000);

  it("identifies the query whose expected result is incorrect", async () => {
    const query = structuredClone(workload.queries[0]) as BenchmarkQuery;
    query.expected.topUrl = "/incorrect.html";

    await expect(
      measureBrowser({
        config: SMOKE_CONFIG,
        queries: [query],
        server,
        artifacts,
      }),
    ).rejects.toThrow(/single-term/);
  }, 30_000);
});

it("rejects an unexpected successful index response during warm measurement", async () => {
  const html = `<!doctype html><script>
    window.searchableBenchmark = {
      count: 0,
      async initialize() { return 0.1; },
      async search() {
        this.count += 1;
        if (this.count === 2) await fetch("/index/probe.json");
        return {
          durationMs: 0.1,
          result: { hits: [], totalHits: 0, language: "en" },
        };
      },
      heap() { return { status: "unavailable", reason: "test" }; },
      dispose() {},
    };
  </script>`;
  const nodeServer = createServer((request, response) => {
    if (request.url === "/index/probe.json") {
      response
        .writeHead(200, { "content-type": "application/json" })
        .end('{"ok":true}');
      return;
    }
    response.writeHead(200, { "content-type": "text/html" }).end(html);
  });
  await new Promise<void>((resolve) =>
    nodeServer.listen(0, "127.0.0.1", resolve),
  );
  const address = nodeServer.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/`;
  const server: BenchmarkServer = {
    baseUrl,
    indexUrl: new URL("index/manifest.json", baseUrl).href,
    close: () => new Promise((resolve) => nodeServer.close(() => resolve())),
  };
  const query: BenchmarkQuery = {
    id: "network-probe",
    query: "none",
    options: { limit: 10 },
    expected: { totalHits: 0 },
  };

  try {
    await expect(
      measureBrowser({
        config: SMOKE_CONFIG,
        queries: [query],
        server,
        artifacts: [
          {
            path: "probe.json",
            rawBytes: 11,
            gzipBytes: 31,
          },
        ],
      }),
    ).rejects.toThrow(/unexpected warm network/);
  } finally {
    await server.close();
  }
}, 30_000);
