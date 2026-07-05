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
    if (this.#worker) {
      return this.#sendToWorker<SearchResult>({
        type: "search",
        query,
        options,
      });
    }
    // biome-ignore lint/style/noNonNullAssertion: set in the non-worker branch of the constructor, always resolved once #ready resolves
    const manifest = await this.#manifest!;
    return search(query, manifest, this.#cache, this.#indexUrl, options);
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
