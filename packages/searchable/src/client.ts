import { ShardCache } from "./fetch-json.js";
import type { Manifest } from "./format/index.js";
import type {
  FacetResult,
  FacetValuesOptions,
  SearchOptions,
  SearchResult,
} from "./search.js";
import { facetValues, search } from "./search.js";
import { validateManifest } from "./validate-manifest.js";

/**
 * Resolves indexUrl to an absolute URL up front. Every later shard/doc
 * fetch is resolved *relative to the manifest's URL*
 * (docs/reference/client-api.md), which requires an absolute base — `fetch()`
 * itself tolerates a relative indexUrl (resolving it against the
 * page's own location transparently), but `new URL(relPath, baseUrl)`
 * does not accept a relative baseUrl, so a relative indexUrl has to be
 * made absolute exactly once, here, rather than failing deep inside
 * shard resolution. `self.location` covers the main thread (it has a
 * `location`); Node has neither, but Node callers are always expected
 * to pass an already-absolute indexUrl anyway.
 */
function toAbsoluteUrl(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    const base = (globalThis as { location?: { href: string } }).location?.href;
    return new URL(url, base).href;
  }
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

/**
 * Rejects with an AbortError as soon as `signal` fires, without
 * cancelling `work` itself -- `work` may be a shared, memoized shard
 * fetch (ShardCache) that other, still-active callers depend on, so
 * aborting the underlying operation
 * out from under them would be wrong. This only cancels *waiting* on
 * the result for the caller who aborted; `work` still runs to
 * completion and populates the cache normally either way.
 */
function raceAbort<T>(
  work: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return work;
  // A synchronous 'query' listener can abort the signal before this
  // subscribes -- test the already-aborted state up front, or the abort
  // event has already fired by the time the listener is added and the
  // work would resolve to a caller who already aborted.
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

export interface SearchClientOptions {
  indexUrl: string;
  /**
   * Allow the manifest to reference shard files on a different origin
   * than the manifest itself. Off by default — a compromised or
   * misconfigured manifest shouldn't be able to make the client fetch
   * arbitrary cross-origin URLs (REVIEW.md#6).
   */
  allowCrossOriginShards?: boolean;
  /**
   * Adds semantic manifest checks beyond the always-on structural/
   * security ones (issue #1 finding 7) — see
   * `ValidateManifestOptions.strict` (`validate-manifest.ts`) for
   * exactly what this adds. Off by default: meant for dev/test and
   * independent-producer conformance checking, not a production
   * deployment's own known-good, indexer-built manifest paying extra
   * validation cost on every page view.
   */
  strict?: boolean;
}

/**
 * Manifest + shard fetch over plain HTTP, boolean AND + BM25F scoring
 * with field/term/document boosts and prefix matching. Executes
 * directly on the calling thread.
 */
export class SearchClient {
  #indexUrl: string;
  #cache = new ShardCache();
  #ready: Promise<void>;
  #manifest?: Promise<Manifest>;
  /**
   * Set once the client is disposed — every future call rejects
   * immediately with this instead of silently continuing to work.
   */
  #fatalError?: Error;
  /**
   * Rejected the moment the client first enters its fatal state
   * (`dispose()`). Every caller-visible public operation races its work
   * against this promise -- so a disposed client promptly rejects
   * in-flight work (manifest loading, shard fetches, search, facets,
   * embeddings). The rejected promise is always consumed by an operation
   * race; a permanent no-op catch keeps it from ever surfacing as an
   * unhandled rejection in the window before the first race subscribes.
   */
  #lifecycleFailure: Promise<never>;
  #allowCrossOriginShards: boolean;
  #strict: boolean;

  constructor(options: SearchClientOptions) {
    this.#lifecycleFailure = new Promise<never>(() => {});
    this.#lifecycleFailure.catch(() => undefined);
    this.#indexUrl = toAbsoluteUrl(options.indexUrl);
    this.#allowCrossOriginShards = options.allowCrossOriginShards ?? false;
    this.#strict = options.strict ?? false;
    this.#manifest = this.#cache
      .fetchJson<Manifest>(this.#indexUrl)
      .then((manifest) =>
        validateManifest(manifest, this.#indexUrl, {
          allowCrossOriginShards: options.allowCrossOriginShards ?? false,
          strict: this.#strict,
        }),
      );
    this.#ready = this.#manifest.then(() => undefined);
  }

  async ready(): Promise<void> {
    await this.#ready;
  }

  /**
   * Shared precondition for every public query method: a fatal init error
   * always wins, the caller's `signal` aborts waiting, the manifest must
   * be resolved, and a fatal error that only surfaces *during* that
   * resolution (rather than before it) is still surfaced. Readiness is
   * raced against `signal` (an abort while initializing rejects promptly
   * without cancelling the shared init) and against the lifecycle failure
   * (a disposal while initializing does the same).
   */
  async #assertUsable(signal: AbortSignal | undefined): Promise<void> {
    if (this.#fatalError) throw this.#fatalError;
    throwIfAborted(signal);

    await this.#raceOperation(this.#ready, signal);

    if (this.#fatalError) throw this.#fatalError;
    throwIfAborted(signal);
  }

  /**
   * Races every caller-visible await against the client lifecycle and the
   * caller's AbortSignal: on `dispose()` the in-flight operation rejects
   * promptly with the fatal error. The shared underlying work
   * (manifest/shards/embeddings) may still complete in the background but
   * is no longer delivered to this caller.
   */
  #raceOperation<T>(
    work: Promise<T>,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    return raceAbort(Promise.race([work, this.#lifecycleFailure]), signal);
  }

  async search(
    query: string,
    options: SearchOptions = {},
  ): Promise<SearchResult> {
    await this.#assertUsable(options.signal);
    // `signal` is stripped before the options cross into the
    // direct-execution search() call -- it doesn't need to know about it
    // (see SearchOptions.signal's doc comment for why cancellation is
    // handled entirely here).
    const { signal, ...rest } = options;
    const work = (async () => {
      // biome-ignore lint/style/noNonNullAssertion: set in the constructor, always resolved once #ready resolves
      const manifest = await this.#manifest!;
      return search(query, manifest, this.#cache, this.#indexUrl, rest);
    })();
    const result = await this.#raceOperation(work, signal);
    // The lifecycle race above normally prevents reaching this point after
    // disposal, but make the invariant explicit: nothing is delivered to a
    // client that has entered its fatal state.
    if (this.#fatalError) throw this.#fatalError;
    return result;
  }

  /**
   * A filter-only facet panel query with no free-text search
   * (docs/reference/client-api.md#facet-only-queries) — e.g. rendering a
   * category-landing-page sidebar before a visitor has typed anything.
   */
  async facetValues(
    field: string,
    options: FacetValuesOptions = {},
  ): Promise<FacetResult> {
    await this.#assertUsable(options.signal);
    const { signal, ...rest } = options;
    const work = (async () => {
      // biome-ignore lint/style/noNonNullAssertion: set in the constructor, always resolved once #ready resolves
      const manifest = await this.#manifest!;
      return facetValues(field, manifest, this.#cache, this.#indexUrl, rest);
    })();
    return raceAbort(work, signal);
  }

  /**
   * Disables further use of the client. Always call this when a client
   * is no longer needed so in-flight operations reject promptly.
   */
  dispose(): void {
    this.#fail(new Error("SearchClient disposed"));
  }

  /**
   * The one cleanup operation for every way a client becomes permanently
   * unusable — `dispose()` or a fatal initialization failure. Records
   * the first failure as `#fatalError` (never overwriting an earlier,
   * more specific one). Safe to call repeatedly.
   */
  #fail(error: Error): void {
    if (!this.#fatalError) {
      this.#fatalError = error;
    }
  }
}
