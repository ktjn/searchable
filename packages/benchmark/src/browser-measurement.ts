import type { SearchResult } from "@ktjn/searchable-client";
import type { Page, Request, Response } from "@playwright/test";
import { chromium } from "@playwright/test";
import type { BenchmarkServer } from "./server.js";
import { summarizeSamples } from "./statistics.js";
import type {
  ArtifactMeasurement,
  BenchmarkConfig,
  BenchmarkQuery,
  BrowserMeasurement,
  ColdQueryMeasurement,
  HeapMeasurement,
  TransferSample,
} from "./types.js";
import { assertExpectedResult } from "./workload.js";

export interface MeasureBrowserOptions {
  config: BenchmarkConfig;
  queries: BenchmarkQuery[];
  server: BenchmarkServer;
  artifacts: ArtifactMeasurement[];
}

interface BrowserApi {
  initialize(indexUrl: string): Promise<number>;
  search(
    query: string,
    options: BenchmarkQuery["options"],
  ): Promise<{ durationMs: number; result: SearchResult }>;
  heap(): HeapMeasurement;
  dispose(): void;
}

interface SearchRun {
  durationMs: number;
  result: SearchResult;
  heap: HeapMeasurement;
}

async function loadBenchmarkPage(
  page: Page,
  server: BenchmarkServer,
): Promise<void> {
  await page.goto(server.baseUrl);
  await page.waitForFunction(() =>
    Boolean(
      (window as unknown as { searchableBenchmark?: unknown })
        .searchableBenchmark,
    ),
  );
}

async function initialize(
  page: Page,
  indexUrl: string,
): Promise<{ durationMs: number; heap: HeapMeasurement }> {
  return page.evaluate(async (url) => {
    const api = (window as unknown as { searchableBenchmark: BrowserApi })
      .searchableBenchmark;
    const durationMs = await api.initialize(url);
    return { durationMs, heap: api.heap() };
  }, indexUrl);
}

async function runQuery(page: Page, query: BenchmarkQuery): Promise<SearchRun> {
  return page.evaluate(async (definition) => {
    const api = (window as unknown as { searchableBenchmark: BrowserApi })
      .searchableBenchmark;
    const measured = await api.search(definition.query, definition.options);
    return { ...measured, heap: api.heap() };
  }, query);
}

async function runPass(
  page: Page,
  queries: BenchmarkQuery[],
): Promise<{
  durationMs: number;
  queries: Array<{ id: string; durationMs: number; result: SearchResult }>;
}> {
  return page.evaluate(async (definitions) => {
    const api = (window as unknown as { searchableBenchmark: BrowserApi })
      .searchableBenchmark;
    const started = performance.now();
    const results = [];
    for (const definition of definitions) {
      const measured = await api.search(definition.query, definition.options);
      results.push({ id: definition.id, ...measured });
    }
    return { durationMs: performance.now() - started, queries: results };
  }, queries);
}

async function disposePage(page: Page): Promise<void> {
  await page
    .evaluate(() =>
      (
        window as unknown as { searchableBenchmark: BrowserApi }
      ).searchableBenchmark.dispose(),
    )
    .catch(() => undefined);
}

function createTransferCollector(
  server: BenchmarkServer,
  artifacts: ArtifactMeasurement[],
): {
  handler: (response: Response) => void;
  snapshot: () => Promise<TransferSample>;
} {
  const base = new URL(server.baseUrl);
  const byPath = new Map(
    artifacts.map((artifact) => [artifact.path, artifact]),
  );
  const pending: Array<
    Promise<{ path: string; rawBytes: number; gzipBytes: number }>
  > = [];

  return {
    handler(response) {
      const url = new URL(response.url());
      if (
        url.origin !== base.origin ||
        !url.pathname.startsWith("/index/") ||
        !response.ok()
      ) {
        return;
      }
      const path = decodeURIComponent(url.pathname.slice("/index/".length));
      pending.push(
        (async () => {
          const artifact = byPath.get(path);
          if (!artifact) {
            throw new Error(
              `index response has no artifact measurement: ${path}`,
            );
          }
          const body = await response.body();
          return {
            path,
            rawBytes: body.byteLength,
            gzipBytes: artifact.gzipBytes,
          };
        })(),
      );
    },
    async snapshot() {
      const responses = await Promise.all(pending);
      return {
        requestCount: responses.length,
        rawBytes: responses.reduce(
          (total, response) => total + response.rawBytes,
          0,
        ),
        gzipBytes: responses.reduce(
          (total, response) => total + response.gzipBytes,
          0,
        ),
        paths: responses.map((response) => response.path),
      };
    },
  };
}

async function measureCold(
  options: MeasureBrowserOptions,
  browser: Awaited<ReturnType<typeof chromium.launch>>,
): Promise<ColdQueryMeasurement[]> {
  const measurements: ColdQueryMeasurement[] = [];

  for (const query of options.queries) {
    const initializeSamples: number[] = [];
    const querySamples: number[] = [];
    const combinedSamples: number[] = [];
    const transfers: TransferSample[] = [];
    const heapAfterInitialize: HeapMeasurement[] = [];
    const heapAfterQuery: HeapMeasurement[] = [];

    for (
      let iteration = 0;
      iteration < options.config.warmupCount + options.config.repeatCount;
      iteration += 1
    ) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const collector = createTransferCollector(
        options.server,
        options.artifacts,
      );
      page.on("response", collector.handler);
      try {
        await loadBenchmarkPage(page, options.server);
        const initialized = await initialize(page, options.server.indexUrl);
        const searched = await runQuery(page, query);
        assertExpectedResult(query, searched.result);
        const transfer = await collector.snapshot();

        if (iteration >= options.config.warmupCount) {
          initializeSamples.push(initialized.durationMs);
          querySamples.push(searched.durationMs);
          combinedSamples.push(initialized.durationMs + searched.durationMs);
          transfers.push(transfer);
          heapAfterInitialize.push(initialized.heap);
          heapAfterQuery.push(searched.heap);
        }
      } finally {
        page.off("response", collector.handler);
        await disposePage(page);
        await page.close();
        await context.close();
      }
    }

    measurements.push({
      id: query.id,
      initialize: summarizeSamples(initializeSamples),
      firstQuery: summarizeSamples(querySamples),
      combined: summarizeSamples(combinedSamples),
      requestCount: summarizeSamples(
        transfers.map((transfer) => transfer.requestCount),
      ),
      rawBytes: summarizeSamples(
        transfers.map((transfer) => transfer.rawBytes),
      ),
      gzipBytes: summarizeSamples(
        transfers.map((transfer) => transfer.gzipBytes),
      ),
      transfers,
      heapAfterInitialize,
      heapAfterQuery,
    });
  }

  return measurements;
}

async function measureWarm(
  options: MeasureBrowserOptions,
  browser: Awaited<ReturnType<typeof chromium.launch>>,
): Promise<BrowserMeasurement["warm"]> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const ignoredResponse = (): void => undefined;
  page.on("response", ignoredResponse);
  try {
    await loadBenchmarkPage(page, options.server);
    const initialized = await initialize(page, options.server.indexUrl);
    for (let pass = 0; pass < options.config.warmupCount; pass += 1) {
      const result = await runPass(page, options.queries);
      for (const measured of result.queries) {
        const query = options.queries.find(({ id }) => id === measured.id);
        if (!query) throw new Error(`unknown measured query: ${measured.id}`);
        assertExpectedResult(query, measured.result);
      }
    }

    page.off("response", ignoredResponse);
    const base = new URL(options.server.baseUrl);
    const warmIndexPaths: string[] = [];
    const observeWarmRequest = (request: Request): void => {
      const url = new URL(request.url());
      if (url.origin === base.origin && url.pathname.startsWith("/index/")) {
        warmIndexPaths.push(
          decodeURIComponent(url.pathname.slice("/index/".length)),
        );
      }
    };
    page.on("request", observeWarmRequest);
    const wholePassSamples: number[] = [];
    const querySamples = new Map(
      options.queries.map((query) => [query.id, [] as number[]]),
    );

    try {
      for (let pass = 0; pass < options.config.repeatCount; pass += 1) {
        const result = await runPass(page, options.queries);
        wholePassSamples.push(result.durationMs);
        for (const measured of result.queries) {
          const query = options.queries.find(({ id }) => id === measured.id);
          if (!query) throw new Error(`unknown measured query: ${measured.id}`);
          assertExpectedResult(query, measured.result);
          querySamples.get(measured.id)?.push(measured.durationMs);
        }
      }

      if (warmIndexPaths.length !== 0) {
        throw new Error(
          `unexpected warm network: ${warmIndexPaths.join(", ")}`,
        );
      }

      const heapAfterFinalPass = await page.evaluate(() =>
        (
          window as unknown as { searchableBenchmark: BrowserApi }
        ).searchableBenchmark.heap(),
      );
      return {
        wholePass: summarizeSamples(wholePassSamples),
        queries: options.queries.map((query) => ({
          id: query.id,
          duration: summarizeSamples(querySamples.get(query.id) ?? []),
        })),
        indexRequestCount: 0,
        heapAfterInitialize: initialized.heap,
        heapAfterFinalPass,
      };
    } finally {
      page.off("request", observeWarmRequest);
    }
  } finally {
    page.off("response", ignoredResponse);
    await disposePage(page);
    await page.close();
    await context.close();
  }
}

export async function measureBrowser(
  options: MeasureBrowserOptions,
): Promise<BrowserMeasurement> {
  const browser = await chromium.launch({
    headless: options.config.headless,
    args: ["--enable-precise-memory-info"],
  });
  try {
    return {
      browser: { name: "chromium", version: browser.version() },
      cold: await measureCold(options, browser),
      warm: await measureWarm(options, browser),
    };
  } finally {
    await browser.close();
  }
}
