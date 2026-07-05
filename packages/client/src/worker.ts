/// <reference lib="webworker" />
import type { Manifest } from "@csf/format";
import { ShardCache } from "./fetch-json.js";
import { search } from "./search.js";
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
      manifestPromise = cache.fetchJson<Manifest>(indexUrl);
      await manifestPromise;
      post({ type: "result", id: msg.id, result: { hits: [], totalHits: 0 } });
      return;
    }

    if (!manifestPromise || !indexUrl) {
      throw new Error("worker received a search request before init");
    }
    const manifest = await manifestPromise;
    const result = await search(
      msg.query,
      manifest,
      cache,
      indexUrl,
      msg.options,
    );
    post({ type: "result", id: msg.id, result });
  } catch (err) {
    post({
      type: "error",
      id: msg.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
