import type { SearchOptions, SearchResult } from "./search.js";

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
  | { type: "init"; indexUrl: string; allowCrossOriginShards?: boolean }
  | { type: "search"; query: string; options: SearchOptions };

export type WorkerRequest = WorkerRequestPayload & { id: number };

export type WorkerResponse =
  | { type: "result"; id: number; result: SearchResult }
  | { type: "error"; id: number; message: string };
