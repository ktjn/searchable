import type { Manifest } from "@csf/format";
import { ShardCache } from "./fetch-json.js";
import { facetValues, search } from "./search.js";
import type {
  FacetResult,
  FacetValuesOptions,
  SearchOptions,
  SearchResult,
} from "./search.js";
import { validateManifest } from "./validate-manifest.js";
import type {
  WorkerRequestPayload,
  WorkerResponse,
} from "./worker-protocol.js";

/**
 * Resolves indexUrl to an absolute URL up front. Every later shard/doc
 * fetch is resolved *relative to the manifest's URL*
 * (docs/07-client-api.md), which requires an absolute base — `fetch()`
 * itself tolerates a relative indexUrl (resolving it against the
 * page's own location transparently), but `new URL(relPath, baseUrl)`
 * does not accept a relative baseUrl, so a relative indexUrl has to be
 * made absolute exactly once, here, rather than failing deep inside
 * shard resolution. `self.location` covers both the main thread and a
 * Worker (both have a `location`); Node has neither, but Node callers
 * are always expected to pass an already-absolute indexUrl anyway.
 */
function toAbsoluteUrl(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    const base = (globalThis as { location?: { href: string } }).location?.href;
    return new URL(url, base).href;
  }
}

export interface SearchClientOptions {
  indexUrl: string;
  /**
   * Run analysis/scoring in a Web Worker so keystroke-driven queries
   * never block the main thread (docs/08-modern-features.md#web-worker-execution).
   * Defaults to true, but only takes effect when `workerUrl` is also
   * given — see its docs below for why. Falls back to direct,
   * same-thread execution otherwise — same public API either way.
   */
  worker?: boolean;
  /**
   * URL of this package's built worker.js (its dist/worker.js).
   * Deliberately not auto-resolved: every bundler (Vite, webpack,
   * esbuild...) has its own incompatible convention for referencing a
   * sibling worker file from a library, and guessing one would silently
   * break under the others. Pass whatever URL your build/CDN serves
   * worker.js at — e.g. `new URL("@csf/client/dist/worker.js", import.meta.url)`
   * if your bundler resolves bare specifiers there, or a plain string
   * pointing at wherever you've copied/deployed it. Omit to run on the
   * main thread regardless of `worker`.
   */
  workerUrl?: string | URL;
  /**
   * Allow the manifest to reference shard files on a different origin
   * than the manifest itself. Off by default — a compromised or
   * misconfigured manifest shouldn't be able to make the client fetch
   * arbitrary cross-origin URLs (REVIEW.md#6).
   */
  allowCrossOriginShards?: boolean;
}

interface PendingRequest {
  resolve: (result: SearchResult | FacetResult) => void;
  reject: (err: Error) => void;
}

/**
 * Lifecycle events a consumer can observe without the library phoning
 * home itself (docs/08-modern-features.md#observability-hooks) —
 * click-through tracking or zero-result-query logging are consuming-app
 * concerns built on top of these, not something this library bundles.
 * Scoped to `search()` only, not `facetValues()`: "a query was issued"
 * is naturally about free-text search, and a facet-only browsing call
 * has no query text for a "query" event to carry. A fuller diagnostics
 * surface (phase timings, per-plugin attribution) is a separate,
 * larger spec (spec-diagnostics.md), not this first slice.
 */
export interface SearchClientEventMap {
  /** Fired synchronously the moment search() is called, before any fetch/worker round trip. */
  query: { query: string; options: SearchOptions };
  /** Fired once search() resolves, with the same query/options plus the result. */
  result: { query: string; options: SearchOptions; result: SearchResult };
}

type SearchClientEvent = keyof SearchClientEventMap;
// biome-ignore lint/suspicious/noExplicitAny: a listener map keyed by event name can't stay precisely typed per-key without an event-specific overload set this hand-rolled emitter doesn't need; on()/#emit() re-establish the precise type at their public boundary.
type AnyListener = (payload: any) => void;

/**
 * Manifest + shard fetch over plain HTTP, boolean AND + BM25F scoring
 * with field/term/document boosts and prefix matching. Executes in a
 * Worker by default; the direct-execution path below is not a
 * secondary/legacy mode, it's the same code the Worker itself calls
 * (see worker.ts), just invoked in-process when a Worker isn't used.
 */
export class SearchClient {
  #indexUrl: string;
  #cache = new ShardCache();
  #ready: Promise<void>;
  #manifest?: Promise<Manifest>;
  #worker: Worker | undefined;
  #nextRequestId = 0;
  #pendingRequests = new Map<number, PendingRequest>();
  /**
   * Set once the client is disposed, or the worker hits a fatal
   * (not per-request) error — every future call rejects immediately
   * with this instead of hanging on a dead worker (or, in main-thread
   * mode, silently continuing to work after `dispose()`).
   */
  #fatalError?: Error;
  #listeners = new Map<SearchClientEvent, Set<AnyListener>>();

  constructor(options: SearchClientOptions) {
    this.#indexUrl = toAbsoluteUrl(options.indexUrl);
    const wantsWorker =
      options.worker !== false &&
      options.workerUrl !== undefined &&
      typeof Worker !== "undefined";

    if (wantsWorker) {
      this.#worker = new Worker(options.workerUrl as string | URL, {
        type: "module",
      });
      this.#worker.addEventListener("message", (event: MessageEvent) => {
        this.#handleWorkerMessage(event.data);
      });
      this.#worker.addEventListener("error", (event: ErrorEvent) => {
        this.#handleWorkerFatalError(
          new Error(event.message || "worker encountered a fatal error"),
        );
      });
      this.#worker.addEventListener("messageerror", () => {
        this.#handleWorkerFatalError(
          new Error("worker message could not be deserialized"),
        );
      });
      this.#ready = this.#sendToWorker({
        type: "init",
        indexUrl: this.#indexUrl,
        ...(options.allowCrossOriginShards !== undefined
          ? { allowCrossOriginShards: options.allowCrossOriginShards }
          : {}),
      }).then(() => undefined);
    } else {
      this.#manifest = this.#cache
        .fetchJson<Manifest>(this.#indexUrl)
        .then((manifest) =>
          validateManifest(manifest, this.#indexUrl, {
            allowCrossOriginShards: options.allowCrossOriginShards ?? false,
          }),
        );
      this.#ready = this.#manifest.then(() => undefined);
    }
  }

  async ready(): Promise<void> {
    await this.#ready;
  }

  async search(
    query: string,
    options: SearchOptions = {},
  ): Promise<SearchResult> {
    if (this.#fatalError) throw this.#fatalError;
    await this.#ready;
    if (this.#fatalError) throw this.#fatalError;
    this.#emit("query", { query, options });
    const result = this.#worker
      ? await this.#sendToWorker<SearchResult>({
          type: "search",
          query,
          options,
        })
      : await search(
          query,
          // biome-ignore lint/style/noNonNullAssertion: set in the non-worker branch of the constructor, always resolved once #ready resolves
          await this.#manifest!,
          this.#cache,
          this.#indexUrl,
          options,
        );
    this.#emit("result", { query, options, result });
    return result;
  }

  /**
   * Subscribe to a lifecycle event (docs/08-modern-features.md#observability-hooks).
   * Returns an unsubscribe function rather than requiring a separate
   * `off()` call — the caller already has the one reference it needs to
   * stop listening, so a second method just for that would be redundant.
   */
  on<K extends SearchClientEvent>(
    event: K,
    listener: (payload: SearchClientEventMap[K]) => void,
  ): () => void {
    let set = this.#listeners.get(event);
    if (!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(listener as AnyListener);
    return () => {
      set?.delete(listener as AnyListener);
    };
  }

  #emit<K extends SearchClientEvent>(
    event: K,
    payload: SearchClientEventMap[K],
  ): void {
    const set = this.#listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(payload);
      } catch {
        // A listener throwing (e.g. a broken analytics integration)
        // must not break the search() call it's observing -- this is
        // a side-channel notification, not part of the query's own
        // control flow.
      }
    }
  }

  /**
   * A filter-only facet panel query with no free-text search
   * (docs/07-client-api.md#facet-only-queries) — e.g. rendering a
   * category-landing-page sidebar before a visitor has typed anything.
   */
  async facetValues(
    field: string,
    options: FacetValuesOptions = {},
  ): Promise<FacetResult> {
    if (this.#fatalError) throw this.#fatalError;
    await this.#ready;
    if (this.#fatalError) throw this.#fatalError;
    if (this.#worker) {
      return this.#sendToWorker<FacetResult>({
        type: "facetValues",
        field,
        options,
      });
    }
    // biome-ignore lint/style/noNonNullAssertion: set in the non-worker branch of the constructor, always resolved once #ready resolves
    const manifest = await this.#manifest!;
    return facetValues(field, manifest, this.#cache, this.#indexUrl, options);
  }

  /**
   * Terminates the underlying worker (if any) and rejects every
   * in-flight request. Always call this when a client is no longer
   * needed — an undisposed worker keeps running, and any request still
   * pending against it would otherwise never settle. Idempotent, and
   * also disables further use in main-thread (non-worker) mode, so
   * `dispose()` means the same thing regardless of which mode the
   * client happens to be running in.
   */
  dispose(): void {
    if (this.#fatalError) return;
    this.#worker?.terminate();
    this.#worker = undefined;
    this.#setFatalError(new Error("SearchClient disposed"));
  }

  #handleWorkerFatalError(err: Error): void {
    this.#setFatalError(err);
  }

  #setFatalError(err: Error): void {
    if (this.#fatalError) return;
    this.#fatalError = err;
    for (const pending of this.#pendingRequests.values()) {
      pending.reject(err);
    }
    this.#pendingRequests.clear();
  }

  #sendToWorker<T extends SearchResult | FacetResult>(
    message: WorkerRequestPayload,
  ): Promise<T> {
    if (this.#fatalError) {
      return Promise.reject(this.#fatalError);
    }
    const id = this.#nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      this.#pendingRequests.set(id, {
        resolve: resolve as (result: SearchResult | FacetResult) => void,
        reject,
      });
      // biome-ignore lint/style/noNonNullAssertion: only called when #worker was constructed and not yet disposed
      this.#worker!.postMessage({ ...message, id });
    });
  }

  #handleWorkerMessage(message: WorkerResponse): void {
    const pending = this.#pendingRequests.get(message.id);
    if (!pending) return;
    this.#pendingRequests.delete(message.id);
    if (message.type === "error") {
      pending.reject(new Error(message.message));
    } else {
      pending.resolve(message.result);
    }
  }
}
