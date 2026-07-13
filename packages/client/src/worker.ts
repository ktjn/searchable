/// <reference lib="webworker" />
import type { Manifest } from "@ktjn/searchable-format";
import { ShardCache } from "./fetch-json.js";
import { facetValues, search, searchStream } from "./search.js";
import { validateManifest } from "./validate-manifest.js";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol.js";

const cache = new ShardCache();
let manifestPromise: Promise<Manifest> | undefined;
let indexUrl: string | undefined;

function post(message: WorkerResponse): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(message);
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === "init") {
      indexUrl = msg.indexUrl;
      manifestPromise = cache.fetchJson<Manifest>(indexUrl).then((manifest) =>
        validateManifest(manifest, indexUrl as string, {
          allowCrossOriginShards: msg.allowCrossOriginShards ?? false,
          strict: msg.strict ?? false,
        }),
      );
      const manifest = await manifestPromise;
      post({
        type: "result",
        id: msg.id,
        result: { hits: [], totalHits: 0, language: manifest.defaultLanguage },
      });
      return;
    }

    if (!manifestPromise || !indexUrl) {
      throw new Error(`worker received a ${msg.type} request before init`);
    }
    const manifest = await manifestPromise;
    if (msg.type === "facetValues") {
      const result = await facetValues(
        msg.field,
        manifest,
        cache,
        indexUrl,
        msg.options,
      );
      post({ type: "result", id: msg.id, result });
    } else if (msg.type === "searchStream") {
      const result = await searchStream(
        msg.query,
        manifest,
        cache,
        indexUrl,
        msg.options,
        (partial) => post({ type: "partial", id: msg.id, result: partial }),
      );
      post({ type: "result", id: msg.id, result });
    } else {
      const result = await search(
        msg.query,
        manifest,
        cache,
        indexUrl,
        msg.options,
        msg.queryVector,
      );
      post({ type: "result", id: msg.id, result });
    }
  } catch (err) {
    post({
      type: "error",
      id: msg.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
