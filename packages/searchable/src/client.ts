import { ShardCache } from "./fetch-json.js";
import type { Manifest } from "./format/index.js";
import type {
  FacetResult,
  FacetValuesOptions,
  SearchOptions,
  SearchResult,
} from "./search.js";
import { facetValues, search, searchStream } from "./search.js";
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

/**
 * Clones a `SearchOptions.filters` record plus every nested mutable value:
 * a filter value can be a string, a mutable string array, or a mutable
 * `{ min?, max? }` range object, and all three must be copied so a
 * listener mutating a received snapshot (`filters.category.push(...)`,
 * `filters.price.min = ...`) can't reach the executing query.
 */
function snapshotFilters(
  filters: NonNullable<SearchOptions["filters"]>,
): NonNullable<SearchOptions["filters"]> {
  return Object.fromEntries(
    Object.entries(filters).map(([field, value]) => [
      field,
      Array.isArray(value)
        ? [...value]
        : typeof value === "object"
          ? { ...(value as { min?: number; max?: number }) }
          : value,
    ]),
  );
}

/**
 * Copies the root `SearchOptions` object plus every nested mutable value
 * the query actually reads (`boosts.fields`/`boosts.terms`, `filters`
 * including nested arrays/range objects, `facets`) into a stable
 * snapshot. Event listeners receive this snapshot, not the caller's live
 * object -- so a synchronous 'query' listener that mutates what it
 * receives can never silently change the query that actually runs.
 * `onPartial`/`signal` keep their references (functions and signals aren't
 * clone targets). Cost is negligible relative to shard loading and
 * scoring.
 */
function snapshotSearchOptions<T extends SearchOptions>(options: T): T {
  return {
    ...options,
    ...(options.boosts
      ? {
          boosts: {
            ...(options.boosts.fields
              ? { fields: { ...options.boosts.fields } }
              : {}),
            ...(options.boosts.terms
              ? { terms: { ...options.boosts.terms } }
              : {}),
          },
        }
      : {}),
    ...(options.filters ? { filters: snapshotFilters(options.filters) } : {}),
    ...(options.facets ? { facets: [...options.facets] } : {}),
  };
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

export interface SearchStreamOptions extends SearchOptions {
  /**
   * Invoked once with the fast literal/prefix-only pass's result,
   * before the returned promise resolves to the final,
   * synonym/fuzzy-expanded result (docs/reference/client-api.md#streamingincremental-results).
   * Only fires when `synonyms` and/or `fuzzy` was requested -- see
   * `searchStream()` in packages/client/src/search.ts. Never invoked
   * once `signal` has already fired, matching `search()`'s "nothing is
   * delivered to a caller who already aborted" cancellation semantics.
   */
  onPartial?: (partial: SearchResult) => void;
}

/**
 * Lifecycle events a consumer can observe without the library phoning
 * home itself (docs/reference/client-api.md#events-and-lifecycle) —
 * click-through tracking or zero-result-query logging are consuming-app
 * concerns built on top of these, not something this library bundles.
 * Scoped to `search()` only, not `facetValues()`: "a query was issued"
 * is naturally about free-text search, and a facet-only browsing call
 * has no query text for a "query" event to carry. A fuller diagnostics
 * surface (phase timings, per-plugin attribution) is a separate,
 * larger spec (archive/specs/diagnostics.md), not this first slice.
 */
export interface SearchClientEventMap {
  /** Fired synchronously the moment search() is called, before any fetch round trip. */
  query: { query: string; options: SearchOptions };
  /** Fired once search() resolves, with the same query/options plus the result. */
  result: { query: string; options: SearchOptions; result: SearchResult };
}

type SearchClientEvent = keyof SearchClientEventMap;
// biome-ignore lint/suspicious/noExplicitAny: a listener map keyed by event name can't stay precisely typed per-key without an event-specific overload set this hand-rolled emitter doesn't need; on()/#emit() re-establish the precise type at their public boundary.
type AnyListener = (payload: any) => void;

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
  #listeners = new Map<SearchClientEvent, Set<AnyListener>>();
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
    // Snapshot the options before the query event fires: a synchronous
    // listener may abort (honored by raceAbort's aborted-first check) or
    // mutate the object it receives (`listenerOptions`) -- a deliberately
    // separate snapshot, so mutation can never change the query that
    // actually runs (`effectiveOptions`) or what the 'result' event
    // later reports.
    const effectiveOptions = snapshotSearchOptions(options);
    const listenerOptions = snapshotSearchOptions(options);
    this.#emit("query", { query, options: listenerOptions });
    // `signal` is stripped before the options cross into the
    // direct-execution search() call -- it doesn't need to know about it
    // (see SearchOptions.signal's doc comment for why cancellation is
    // handled entirely here).
    const { signal, ...rest } = effectiveOptions;
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
    this.#emit("result", { query, options: effectiveOptions, result });
    return result;
  }

  /**
   * Streaming/incremental variant of search()
   * (docs/reference/client-api.md#streamingincremental-results): resolves to
   * the same final `SearchResult` `search()` would, but -- whenever
   * `synonyms`/`fuzzy` was requested -- calls `options.onPartial` with
   * the fast literal/prefix-only pass first, so a keystroke-driven UI
   * can render exact matches before the (potentially slower)
   * synonym/fuzzy-expanded pass lands. `onPartial` is guarded against
   * firing after `signal` has already aborted, matching `search()`'s
   * "nothing is delivered to an aborted caller" cancellation semantics
   * -- the underlying passes still run to completion regardless (same
   * "abort only cancels waiting, not the work itself" rule as
   * `search()`).
   */
  async searchStream(
    query: string,
    options: SearchStreamOptions = {},
  ): Promise<SearchResult> {
    await this.#assertUsable(options.signal);
    // Same independent-snapshot-before-emit discipline as search().
    const effectiveOptions = snapshotSearchOptions(options);
    const listenerOptions = snapshotSearchOptions(options);
    this.#emit("query", { query, options: listenerOptions });
    const { signal, onPartial, ...rest } = effectiveOptions;
    const guardedOnPartial = onPartial
      ? (partial: SearchResult) => {
          if (!signal?.aborted && !this.#fatalError) {
            onPartial(partial);
          }
        }
      : undefined;
    const work = (async () => {
      // biome-ignore lint/style/noNonNullAssertion: set in the constructor, always resolved once #ready resolves
      const manifest = await this.#manifest!;
      return searchStream(
        query,
        manifest,
        this.#cache,
        this.#indexUrl,
        rest,
        guardedOnPartial,
      );
    })();
    const result = await this.#raceOperation(work, signal);
    if (this.#fatalError) throw this.#fatalError;
    this.#emit("result", { query, options: effectiveOptions, result });
    return result;
  }

  /**
   * Subscribe to a lifecycle event. Returns an unsubscribe function
   * rather than requiring a separate `off()` call — the caller already
   * has the one reference it needs to stop listening, so a second method
   * just for that would be redundant.
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
