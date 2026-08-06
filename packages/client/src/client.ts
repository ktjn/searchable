import type {
  EmbeddingProviderConfig,
  Manifest,
} from "@ktjn/searchable-format";
import { ShardCache } from "./fetch-json.js";
import type {
  FacetResult,
  FacetValuesOptions,
  SearchOptions,
  SearchResult,
} from "./search.js";
import { facetValues, search, searchStream } from "./search.js";
import { InvalidManifestError, validateManifest } from "./validate-manifest.js";
import {
  VectorProviderMismatchError,
  VectorSearchNotConfiguredError,
} from "./vector-search.js";
import {
  type SerializedWorkerError,
  WORKER_PROTOCOL_VERSION,
  type WorkerInitResult,
  type WorkerRequestPayload,
  type WorkerResponse,
} from "./worker-protocol.js";

/**
 * Resolves indexUrl to an absolute URL up front. Every later shard/doc
 * fetch is resolved *relative to the manifest's URL*
 * (docs/reference/client-api.md), which requires an absolute base — `fetch()`
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

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

/**
 * Shallow-copies the root `SearchOptions` object plus every nested
 * mutable map the query actually reads (`boosts.fields`/`boosts.terms`,
 * `filters`, `facets`) into a stable snapshot. Event listeners receive
 * this snapshot, not the caller's live object -- so a synchronous 'query'
 * listener that mutates `options.filters`/`options.boosts` to observe or
 * tweak state can never silently change the query that actually runs.
 * Cost is negligible relative to shard loading and scoring.
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
    ...(options.filters ? { filters: { ...options.filters } } : {}),
    ...(options.facets ? { facets: [...options.facets] } : {}),
  };
}

/**
 * Normalizes a Worker response's `"error"` payload so both the current
 * (version 2, `error: { code, name, message }`) and legacy (version 1,
 * `message: string`) shapes settle the pending request instead of
 * hanging it. A stale cached Worker script from the previous release
 * still speaks the legacy shape (docs/reference/compatibility.md).
 */
function normalizeWorkerError(
  message: Extract<WorkerResponse, { type: "error" }>,
): SerializedWorkerError {
  if (message.error) return message.error;
  return {
    code: "UNKNOWN",
    name: "Error",
    message: message.message ?? "Unknown Worker error",
  };
}

/**
 * Reconstructs a serialized Worker error (worker-protocol.ts) into the same
 * public error contract direct execution would produce: the exported domain
 * error classes come back as real `instanceof`-compatible instances (keyed by
 * the stable code, not by any embedded class reference), and every other
 * error becomes a plain `Error` keeping its `name`/`message` but not its
 * stack trace.
 */
function deserializeWorkerError(error: SerializedWorkerError): Error {
  switch (error.code) {
    case "INVALID_MANIFEST":
      return new InvalidManifestError(error.message);
    case "VECTOR_SEARCH_NOT_CONFIGURED":
      return new VectorSearchNotConfiguredError(error.message);
    case "VECTOR_PROVIDER_MISMATCH":
      return new VectorProviderMismatchError(error.message);
    default: {
      const err = new Error(error.message);
      err.name = error.name;
      return err;
    }
  }
}

/** Structural equality for the small, fixed `EmbeddingProviderConfig` union -- deliberately not `JSON.stringify` comparison, since key order between a manifest parsed from JSON and a locally-constructed object isn't guaranteed to match. */
function providersMatch(
  a: EmbeddingProviderConfig,
  b: EmbeddingProviderConfig,
): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "local-model" && b.type === "local-model") {
    return a.model === b.model;
  }
  return true;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

/**
 * Rejects with an AbortError as soon as `signal` fires, without
 * cancelling `work` itself -- `work` may be a shared, memoized shard
 * fetch (ShardCache) or an in-flight worker computation that other,
 * still-active callers depend on, so aborting the underlying operation
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
   * Run analysis/scoring in a Web Worker so keystroke-driven queries
   * never block the main thread (docs/concepts/architecture.md).
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
   * worker.js at — e.g. `new URL("@ktjn/searchable-client/dist/worker.js", import.meta.url)`
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
  /**
   * Turns a query string into the vector `options.mode: "vector"`/
   * `"hybrid"` search needs (docs/guides/vector-search.md#the-hard-constraint-where-does-the-query-embedding-come-from).
   * Deliberately not provided by this library: what produces this
   * vector (a bundled local model, a call to a remote embedding API, or
   * anything else) is a deployment choice this project stays agnostic
   * to — the resulting `number[]` must have the same dimensionality as
   * the manifest's vector shards, and must come from the same embedding
   * model/process that produced them. Omitting this while
   * requesting `mode: "vector"`/`"hybrid"` throws
   * `VectorSearchNotConfiguredError` rather than silently searching
   * lexical-only.
   *
   * Accepts either a bare function (this library has no way to know
   * what produced its vectors, so no provider-mismatch check is
   * possible) or `{embed, provider}` — the object form this package's
   * own `createTransformersEmbedQuery()` returns — so `SearchClient` can
   * compare `provider` against the manifest's own
   * `vectors.embeddingProvider` and fail fast on a mismatch instead of
   * silently comparing a query embedded by one model against corpus
   * vectors built by another (see `validateVectorProvider` below).
   */
  embedQuery?:
    | ((query: string) => Promise<number[]> | number[])
    | {
        embed: (query: string) => Promise<number[]> | number[];
        provider: EmbeddingProviderConfig;
      };
  /**
   * When `embedQuery` is given in its `{embed, provider}` form, compares
   * `provider` against the manifest's `vectors.embeddingProvider` before
   * ever computing a query vector, throwing `VectorProviderMismatchError`
   * on a mismatch. Defaults to `true` — set `false` only for a
   * deployment that's certain a mismatch is intentional (e.g. testing
   * cross-model behavior). Has no effect when `embedQuery` is a bare
   * function, since this library then has no provider to compare.
   */
  validateVectorProvider?: boolean;
}

interface PendingRequest {
  resolve: (result: SearchResult | FacetResult | WorkerInitResult) => void;
  reject: (err: Error) => void;
  /** Only set for a searchStream() request -- see #handleWorkerMessage. */
  onPartial?: (result: SearchResult) => void;
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
  #embedQuery: SearchClientOptions["embedQuery"];
  #validateVectorProvider: boolean;
  #allowCrossOriginShards: boolean;
  #strict: boolean;
  /**
   * A manifest fetch used *only* to read `vectors.embeddingProvider` for
   * provider-mismatch validation when running in Worker mode (where
   * `#manifest` below is never set — the Worker holds its own copy).
   * Lazily created on first use, not in the constructor, so a client
   * that never requests `mode: "vector"`/`"hybrid"` with a
   * provider-carrying `embedQuery` never pays for a second manifest
   * fetch alongside the Worker's own.
   */
  #vectorValidationManifest?: Promise<Manifest>;

  constructor(options: SearchClientOptions) {
    this.#indexUrl = toAbsoluteUrl(options.indexUrl);
    this.#embedQuery = options.embedQuery;
    this.#validateVectorProvider = options.validateVectorProvider ?? true;
    this.#allowCrossOriginShards = options.allowCrossOriginShards ?? false;
    this.#strict = options.strict ?? false;
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
      this.#ready = this.#sendToWorker<WorkerInitResult>({
        type: "init",
        protocolVersion: WORKER_PROTOCOL_VERSION,
        indexUrl: this.#indexUrl,
        ...(options.allowCrossOriginShards !== undefined
          ? { allowCrossOriginShards: options.allowCrossOriginShards }
          : {}),
        ...(options.strict !== undefined ? { strict: options.strict } : {}),
      })
        .then((initResult) => {
          this.#assertProtocolCompatible(initResult.protocolVersion);
        })
        .catch((error: unknown) => {
          // A Worker whose initiation failed (invalid manifest, unknown
          // domain error, protocol mismatch, ...) can never become usable:
          // terminate and dereference it so the client can't keep a
          // reference to a doomed worker, and record the original error as
          // the client's fatal error so future calls fail immediately with
          // the same type/message (docs/reference/compatibility.md).
          const normalized =
            error instanceof Error ? error : new Error(String(error));
          this.#fail(normalized);
          throw normalized;
        });
    } else {
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
  }

  async ready(): Promise<void> {
    await this.#ready;
  }

  /**
   * Shared precondition for every public query method: a fatal init error
   * always wins, the caller's `signal` aborts waiting, the manifest (or
   * worker `init`) must be resolved, and a fatal error that only surfaces
   * *during* that resolution (rather than before it) is still surfaced.
   */
  async #assertUsable(signal: AbortSignal | undefined): Promise<void> {
    if (this.#fatalError) throw this.#fatalError;
    throwIfAborted(signal);
    await this.#ready;
    if (this.#fatalError) throw this.#fatalError;
    throwIfAborted(signal);
  }

  async search(
    query: string,
    options: SearchOptions = {},
  ): Promise<SearchResult> {
    await this.#assertUsable(options.signal);
    // Computed here, not inside search.ts, because `embedQuery` is
    // arbitrary caller JS that can't cross the Worker postMessage
    // boundary -- only its plain-array *result* can
    // (docs/guides/vector-search.md).
    const queryVector = await this.#resolveQueryVector(query, options.mode);
    throwIfAborted(options.signal);
    // Snapshot the options before the query event fires: a synchronous
    // listener may abort (honored by raceAbort's aborted-first check) or
    // mutate the object it receives (`listenerOptions`) -- a deliberately
    // separate snapshot, so mutation can never change the query that
    // actually runs (`effectiveOptions`) or what the 'result' event
    // later reports.
    const effectiveOptions = snapshotSearchOptions(options);
    const listenerOptions = snapshotSearchOptions(options);
    this.#emit("query", { query, options: listenerOptions });
    // `signal` is stripped before the options cross into the worker
    // message or the direct-execution search() call -- neither needs
    // to know about it (see SearchOptions.signal's doc comment for why
    // cancellation is handled entirely here).
    const { signal, ...rest } = effectiveOptions;
    const work = this.#worker
      ? this.#sendToWorker<SearchResult>({
          type: "search",
          query,
          options: rest,
          ...(queryVector ? { queryVector } : {}),
        })
      : (async () => {
          // biome-ignore lint/style/noNonNullAssertion: set in the non-worker branch of the constructor, always resolved once #ready resolves
          const manifest = await this.#manifest!;
          return search(
            query,
            manifest,
            this.#cache,
            this.#indexUrl,
            rest,
            queryVector,
          );
        })();
    const result = await raceAbort(work, signal);
    this.#emit("result", { query, options: effectiveOptions, result });
    return result;
  }

  /**
   * Resolves `options.mode`'s query embedding, if any is needed
   * (docs/guides/vector-search.md#api-surface). Returns
   * `undefined` for `mode: "lexical"` (the default) — no embedding is
   * ever computed unless a caller actually opts into vector/hybrid
   * search, matching the "pay only for what you use" principle every
   * other opt-in feature here follows.
   */
  async #resolveQueryVector(
    query: string,
    mode: SearchOptions["mode"],
  ): Promise<number[] | undefined> {
    if (mode !== "vector" && mode !== "hybrid") return undefined;
    if (!this.#embedQuery) {
      throw new VectorSearchNotConfiguredError(
        `SearchClient.search: mode "${mode}" requires SearchClientOptions.embedQuery to be configured — see docs/guides/vector-search.md#the-hard-constraint-where-does-the-query-embedding-come-from`,
      );
    }
    if (typeof this.#embedQuery === "function") {
      return this.#embedQuery(query);
    }
    const { embed, provider } = this.#embedQuery;
    if (this.#validateVectorProvider) {
      await this.#checkVectorProvider(provider);
    }
    return embed(query);
  }

  /**
   * Compares `embedQuery`'s declared `provider` against the manifest's
   * own `vectors.embeddingProvider`, throwing `VectorProviderMismatchError`
   * on a mismatch (see `SearchClientOptions.validateVectorProvider`). A
   * manifest with no `vectors` configured at all isn't this check's
   * job to report -- `search.ts`'s own `VectorSearchNotConfiguredError`
   * (thrown when there's no vector shard to search at all) covers that
   * case with a clearer, more specific message.
   */
  async #checkVectorProvider(provider: EmbeddingProviderConfig): Promise<void> {
    const manifest = await this.#getManifestForVectorValidation();
    const manifestProvider = manifest.vectors?.embeddingProvider;
    if (!manifestProvider) return;
    if (!providersMatch(provider, manifestProvider)) {
      throw new VectorProviderMismatchError(
        `SearchClient.search: embedQuery's provider (${JSON.stringify(provider)}) does not match this index's vectors.embeddingProvider (${JSON.stringify(manifestProvider)}) — comparing a query embedded by one model against corpus vectors built by another produces meaningless scores. Pass validateVectorProvider: false to opt out if this mismatch is intentional.`,
      );
    }
  }

  /**
   * The main-thread's own copy of the manifest, needed only to read
   * `vectors.embeddingProvider` for the check above. In non-worker mode
   * this is just `#manifest`, already resolved; in Worker mode the
   * manifest normally lives only inside the Worker, so this lazily
   * fetches+validates a second copy on the main thread, once, the first
   * time it's actually needed.
   */
  #getManifestForVectorValidation(): Promise<Manifest> {
    if (this.#manifest) return this.#manifest;
    if (!this.#vectorValidationManifest) {
      this.#vectorValidationManifest = this.#cache
        .fetchJson<Manifest>(this.#indexUrl)
        .then((manifest) =>
          validateManifest(manifest, this.#indexUrl, {
            allowCrossOriginShards: this.#allowCrossOriginShards,
            strict: this.#strict,
          }),
        );
    }
    return this.#vectorValidationManifest;
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
          if (!signal?.aborted) onPartial(partial);
        }
      : undefined;
    const work = this.#worker
      ? this.#sendToWorker<SearchResult>(
          { type: "searchStream", query, options: rest },
          guardedOnPartial,
        )
      : (async () => {
          // biome-ignore lint/style/noNonNullAssertion: set in the non-worker branch of the constructor, always resolved once #ready resolves
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
    const result = await raceAbort(work, signal);
    this.#emit("result", { query, options: effectiveOptions, result });
    return result;
  }

  /**
   * Subscribe to a lifecycle event (docs/reference/client-api.md#events-and-lifecycle).
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
   * (docs/reference/client-api.md#facet-only-queries) — e.g. rendering a
   * category-landing-page sidebar before a visitor has typed anything.
   */
  async facetValues(
    field: string,
    options: FacetValuesOptions = {},
  ): Promise<FacetResult> {
    await this.#assertUsable(options.signal);
    const { signal, ...rest } = options;
    const work = this.#worker
      ? this.#sendToWorker<FacetResult>({
          type: "facetValues",
          field,
          options: rest,
        })
      : (async () => {
          // biome-ignore lint/style/noNonNullAssertion: set in the non-worker branch of the constructor, always resolved once #ready resolves
          const manifest = await this.#manifest!;
          return facetValues(
            field,
            manifest,
            this.#cache,
            this.#indexUrl,
            rest,
          );
        })();
    return raceAbort(work, signal);
  }

  /**
   * Terminates the underlying worker (if any) and rejects every
   * in-flight request. Always call this when a client is no longer
   * needed — an undisposed worker keeps running, and any request still
   * pending against it would otherwise never settle. Idempotent, and
   * also disables further use in main-thread (non-worker) mode, so
   * `dispose()` means the same thing regardless of which mode the
   * client happens to be running in. Delegates all of that to the same
   * internal `#fail()` cleanup a fatal worker error triggers, so every
   * path that retires a client converges on one operation.
   */
  dispose(): void {
    this.#fail(new Error("SearchClient disposed"));
  }

  #handleWorkerFatalError(err: Error): void {
    this.#fail(err);
  }

  /**
   * The one cleanup operation for every way a worker/client becomes
   * permanently unusable — `dispose()`, a worker `error` event, a
   * `messageerror` (a message that can't be deserialized even though the
   * worker script itself is fine — which is *not* guaranteed to
   * terminate the worker, so the reference must be dropped explicitly),
   * and fatal initialization failures.
   *
   * Terminates and dereferences the worker, records the first failure as
   * `#fatalError` (never overwriting an earlier, more specific one),
   * and settles every still-pending request exactly once with it. Safe
   * to call repeatedly and in any order: after the first call the worker
   * is gone, `#pendingRequests` is empty, and future calls fail
   * immediately from `#assertUsable()`/`#sendToWorker()` with the stored
   * `#fatalError`.
   */
  #fail(error: Error): void {
    this.#worker?.terminate();
    this.#worker = undefined;

    if (!this.#fatalError) {
      this.#fatalError = error;
    }

    for (const pending of this.#pendingRequests.values()) {
      pending.reject(this.#fatalError);
    }
    this.#pendingRequests.clear();
  }

  #assertProtocolCompatible(version: number | undefined): void {
    // A missing version means the Worker predates the protocol handshake
    // (version 1, legacy `{ message }` error payloads), which the
    // normalization layer still accepts during the transition period -- so
    // only a *known* foreign version is a hard incompatibility.
    if (version === undefined || version === WORKER_PROTOCOL_VERSION) return;
    throw new Error(
      `SearchClient: worker protocol version ${version} is not supported (expected ${WORKER_PROTOCOL_VERSION}) — deploy index.js and worker.js from the same package version (docs/reference/compatibility.md)`,
    );
  }

  #sendToWorker<T extends SearchResult | FacetResult | WorkerInitResult>(
    message: WorkerRequestPayload,
    onPartial?: (result: SearchResult) => void,
  ): Promise<T> {
    if (this.#fatalError) {
      return Promise.reject(this.#fatalError);
    }
    const id = this.#nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      this.#pendingRequests.set(id, {
        resolve: resolve as (
          result: SearchResult | FacetResult | WorkerInitResult,
        ) => void,
        reject,
        ...(onPartial ? { onPartial } : {}),
      });
      // biome-ignore lint/style/noNonNullAssertion: only called when #worker was constructed and not yet disposed
      this.#worker!.postMessage({ ...message, id });
    });
  }

  #handleWorkerMessage(message: WorkerResponse): void {
    try {
      const pending = this.#pendingRequests.get(message.id);
      if (!pending) return;
      // A "partial" message doesn't settle the request -- the final
      // "result"/"error" message for the same id still follows.
      if (message.type === "partial") {
        pending.onPartial?.(message.result);
        return;
      }
      // Normalize and deserialize *before* peeling the pending request
      // off the map: if this throws (malformed message), the request must
      // still settle -- via the fatal path below -- rather than being left
      // to hang after its entry was already removed.
      if (message.type === "error") {
        const error = deserializeWorkerError(normalizeWorkerError(message));
        this.#pendingRequests.delete(message.id);
        pending.reject(error);
        return;
      }
      this.#pendingRequests.delete(message.id);
      pending.resolve(message.result);
    } catch (error) {
      // A malformed Worker message must never leave pending requests
      // unresolved -- retire the whole client so every pending request
      // settles with the stored fatal error and future calls fail fast.
      this.#fail(
        error instanceof Error ? error : new Error("Invalid Worker response"),
      );
    }
  }
}
