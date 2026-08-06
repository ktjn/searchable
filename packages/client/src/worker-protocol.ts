import type {
  FacetResult,
  FacetValuesOptions,
  SearchOptions,
  SearchResult,
} from "./search.js";

/**
 * Wire format between the main-thread SearchClient and the Worker,
 * shared by both sides (client.ts, worker.ts) so they can't drift on
 * message shape independently (same pattern as @ktjn/searchable-format between
 * indexer and client).
 *
 * `WorkerRequestPayload` (no `id`) is what a caller constructs;
 * `WorkerRequest` (with `id`) is what actually goes over the wire —
 * kept separate because `Omit<T, "id">` does not distribute over a
 * discriminated union, it collapses it.
 */
/**
 * Version of the wire protocol between `index.js` and `worker.js`. Bumped
 * on the second release of the typed-error protocol: the main thread sends
 * it in `init` and the Worker echoes it back in its `init` result, so a
 * mixed-version deployment (a stale cached Worker next to a freshly
 * deployed bundle, or vice versa) can be detected and failed safely rather
 * than hanging. A Worker that doesn't return a `protocolVersion` is
 * treated as the pre-handshake (version 1) protocol: its legacy
 * `{ message }` error payloads are still accepted during the transition
 * period (see `client.ts`'s `normalizeWorkerError` and
 * docs/reference/compatibility.md).
 */
export const WORKER_PROTOCOL_VERSION = 2;

export interface WorkerInitResult {
  protocolVersion: number;
}

/**
 * The `init` request's `result` is protocol metadata
 * (`WorkerInitResult`), not a search result -- a fresh `init` implies no
 * query has run yet. Search/facet requests carry `SearchResult`/`FacetResult`
 * as today.
 */
export type WorkerRequestPayload =
  | {
      type: "init";
      indexUrl: string;
      protocolVersion?: number;
      allowCrossOriginShards?: boolean;
      strict?: boolean;
    }
  | {
      type: "search";
      query: string;
      options: SearchOptions;
      /**
       * Precomputed by SearchClient from its `embedQuery` before the
       * message is sent, when `options.mode` is `"vector"`/`"hybrid"` —
       * a query embedding function is arbitrary caller JS and can't
       * cross the postMessage boundary, only its plain-array *result*
       * can (docs/guides/vector-search.md).
       */
      queryVector?: number[];
    }
  | { type: "searchStream"; query: string; options: SearchOptions }
  | { type: "facetValues"; field: string; options: FacetValuesOptions };

export type WorkerRequest = WorkerRequestPayload & { id: number };

/**
 * Stable error codes for the exported domain error classes, shared by the
 * Worker's serializer (worker.ts) and the main thread's reconstructor
 * (client.ts) so both sides can't drift on the mapping independently.
 * `UNKNOWN` covers every error that isn't one of the exported classes. The
 * error payload deliberately carries `name`/`message` but never a stack
 * trace: stacks can expose internal paths and aren't a stable API.
 */
export const WORKER_ERROR_CODES = {
  INVALID_MANIFEST: "INVALID_MANIFEST",
  VECTOR_SEARCH_NOT_CONFIGURED: "VECTOR_SEARCH_NOT_CONFIGURED",
  VECTOR_PROVIDER_MISMATCH: "VECTOR_PROVIDER_MISMATCH",
  SEARCH_CLIENT_DISPOSED: "SEARCH_CLIENT_DISPOSED",
  UNKNOWN: "UNKNOWN",
} as const;

export type WorkerErrorCode =
  (typeof WORKER_ERROR_CODES)[keyof typeof WORKER_ERROR_CODES];

export interface SerializedWorkerError {
  code: WorkerErrorCode;
  name: string;
  message: string;
}

export type WorkerResponse =
  | {
      type: "result";
      id: number;
      result: SearchResult | FacetResult | WorkerInitResult;
    }
  /**
   * The literal/prefix-only pass of a `searchStream` request
   * (docs/reference/client-api.md#streamingincremental-results) -- sent
   * *in addition to*, and always before, the final `"result"` message
   * for the same `id`. The pending request stays open after this
   * arrives; only `"result"`/`"error"` settle it.
   */
  | { type: "partial"; id: number; result: SearchResult }
  /**
   * `error` is the current payload (version 2, worker-protocol.ts);
   * `message` is the legacy (version 1) payload a stale cached Worker
   * script still sends. Both are optional in the type because the main
   * thread's handler peels the pending request off only after
   * normalizing either shape -- see `client.ts`'s
   * `normalizeWorkerError()`. Neither being present falls back to a
   * generic "Unknown Worker error" rather than hanging the request.
   */
  | {
      type: "error";
      id: number;
      error?: SerializedWorkerError;
      message?: string;
    };
