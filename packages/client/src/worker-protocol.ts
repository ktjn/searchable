import type {
  FacetResult,
  FacetValuesOptions,
  SearchOptions,
  SearchResult,
} from "./search.js";

/**
 * Wire format between the main-thread SearchClient and the Worker,
 * shared by both sides (client.ts, worker.ts) so they can't drift on
 * message shape independently (same pattern as @csf/format between
 * indexer and client).
 *
 * `WorkerRequestPayload` (no `id`) is what a caller constructs;
 * `WorkerRequest` (with `id`) is what actually goes over the wire —
 * kept separate because `Omit<T, "id">` does not distribute over a
 * discriminated union, it collapses it.
 */
export type WorkerRequestPayload =
  | {
      type: "init";
      indexUrl: string;
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
       * can (docs/13-vector-and-hybrid-search.md).
       */
      queryVector?: number[];
    }
  | { type: "searchStream"; query: string; options: SearchOptions }
  | { type: "facetValues"; field: string; options: FacetValuesOptions };

export type WorkerRequest = WorkerRequestPayload & { id: number };

export type WorkerResponse =
  | { type: "result"; id: number; result: SearchResult | FacetResult }
  /**
   * The literal/prefix-only pass of a `searchStream` request
   * (docs/07-client-api.md#streamingincremental-results) -- sent
   * *in addition to*, and always before, the final `"result"` message
   * for the same `id`. The pending request stays open after this
   * arrives; only `"result"`/`"error"` settle it.
   */
  | { type: "partial"; id: number; result: SearchResult }
  | { type: "error"; id: number; message: string };
