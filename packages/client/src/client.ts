import type { Manifest } from "@csf/format";
import { ShardCache } from "./fetch-json.js";
import { search } from "./search.js";
import type { SearchOptions, SearchResult } from "./search.js";
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
}

interface PendingRequest {
  resolve: (result: SearchResult) => void;
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
  #worker?: Worker;
  #nextRequestId = 0;
  #pendingRequests = new Map<number, PendingRequest>();

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
      this.#ready = this.#sendToWorker({
        type: "init",
        indexUrl: this.#indexUrl,
      }).then(() => undefined);
    } else {
      this.#manifest = this.#cache.fetchJson<Manifest>(this.#indexUrl);
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
    await this.#ready;
    if (this.#worker) {
      return this.#sendToWorker({ type: "search", query, options });
    }
    // biome-ignore lint/style/noNonNullAssertion: set in the non-worker branch of the constructor, always resolved once #ready resolves
    const manifest = await this.#manifest!;
    return search(query, manifest, this.#cache, this.#indexUrl, options);
  }

  #sendToWorker(message: WorkerRequestPayload): Promise<SearchResult> {
    const id = this.#nextRequestId++;
    return new Promise((resolve, reject) => {
      this.#pendingRequests.set(id, { resolve, reject });
      // biome-ignore lint/style/noNonNullAssertion: only called when #worker was constructed
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
