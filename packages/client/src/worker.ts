/// <reference lib="webworker" />
import type { Manifest } from "@ktjn/searchable-format";
import { ShardCache } from "./fetch-json.js";
import { facetValues, search, searchStream } from "./search.js";
import { InvalidManifestError, validateManifest } from "./validate-manifest.js";
import {
  type SerializedWorkerError,
  WORKER_PROTOCOL_VERSION,
  type WorkerRequest,
  type WorkerResponse,
} from "./worker-protocol.js";

const cache = new ShardCache();
let manifestPromise: Promise<Manifest> | undefined;
let indexUrl: string | undefined;

/**
 * Maps an error thrown inside the Worker to its stable serialized form
 * (worker-protocol.ts), preserving the type of the exported domain
 * error classes so the main thread can reconstruct the same `instanceof`
 * contract it would get from direct execution. Deliberately structured
 * as class-based `instanceof` checks rather than `err.name` string
 * matching -- subclassing, minification-independent, and symmetric with
 * how `client.ts` reconstructs them back into real class instances.
 */
function serializeError(err: unknown): SerializedWorkerError {
  if (err instanceof InvalidManifestError) {
    return {
      code: "INVALID_MANIFEST",
      name: err.name,
      message: err.message,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "Error";
  return { code: "UNKNOWN", name, message };
}

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
      // The manifest is still fetched+validated eagerly so `init` reports
      // an invalid manifest (surfaced via the error path below) rather
      // than letting the first query hit it -- but the init *result* the
      // main thread waits on is the protocol handshake, not a search
      // result (worker-protocol.ts).
      await manifestPromise;
      post({
        type: "result",
        id: msg.id,
        result: { protocolVersion: WORKER_PROTOCOL_VERSION },
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
      );
      post({ type: "result", id: msg.id, result });
    }
  } catch (err) {
    post({ type: "error", id: msg.id, error: serializeError(err) });
  }
};
