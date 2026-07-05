# Repository Review

Review target: default branch `claude/client-search-engine-design-zza6m1`.

Scope: static review of documentation, package metadata, core TypeScript packages, and CI configuration. The repository was not run locally during this review.

## Verdict

The direction is good. The architecture is coherent for a client-side static search engine:

- `@csf/analysis` owns shared tokenization and normalization.
- `@csf/format` owns shared manifest and shard types.
- `@csf/indexer` builds static JSON index artifacts from rendered HTML.
- `@csf/client` fetches the manifest/shards and executes search in the browser, optionally in a Web Worker.

The main risk is product/API truthfulness: the docs describe a larger public API than the code currently implements. Fix that before adding more search features.

## High-priority findings

### 1. Client API docs overpromise

`docs/07-client-api.md` documents options and methods that are not implemented yet:

- `cache`
- `prefetchFacets`
- range filters
- `fuzzy`
- `synonyms`
- `page`
- `sort`
- `signal`
- `tookMs`
- `preload()`
- `searchStream()`
- `suggest()`
- `facetValues()`
- federated `indexUrl: string[]`

Actual `SearchClientOptions` only supports:

```ts
indexUrl: string;
worker?: boolean;
workerUrl?: string | URL;
```

Actual `SearchOptions` only supports:

```ts
language?: string;
limit?: number;
boosts?: {
  fields?: Record<string, number>;
  terms?: Record<string, number>;
};
filters?: Record<string, string | string[]>;
facets?: string[];
```

Action:

- Split `docs/07-client-api.md` into `Implemented today` and `Target API` sections.
- Keep unsupported options in roadmap examples only.
- Do not show unsupported API as the primary usage example.

### 2. Worker lifecycle is incomplete

`SearchClient` creates a worker and tracks pending requests, but has no explicit lifecycle or fatal-error handling.

Missing:

- `dispose()` / `terminate()`
- `error` handler
- `messageerror` handler
- rejection of all pending promises after fatal worker failure
- timeout or cancellation path

Risk: a crashed worker can leave promises unresolved forever.

Action:

```ts
public dispose(): void {
  this.#worker?.terminate();
  this.#worker = undefined;

  for (const pending of this.#pendingRequests.values()) {
    pending.reject(new Error("SearchClient disposed"));
  }
  this.#pendingRequests.clear();
}
```

Also register worker-level fatal handlers and fail all pending requests on worker failure.

### 3. Failed shard fetches are cached forever

`ShardCache` caches a `Promise` before it resolves. If a fetch fails once, the rejected promise remains cached and future searches fail even after the network recovers.

Action:

```ts
pending = fetch(url)
  .then((res) => {
    if (!res.ok) throw new Error(`failed to fetch ${url}: ${res.status}`);
    return res.json() as Promise<T>;
  })
  .catch((err) => {
    this.#cache.delete(url);
    throw err;
  });
```

Trade-off: rapid retry storms are possible under unstable network. Add backoff later if needed. Do not keep permanent failure caching.

### 4. Abort/cancellation is documented but absent

The API docs say network-triggering calls are cancellable through `AbortSignal`. The current implementation has no `signal` option, no fetch signal, and no worker cancellation protocol.

Action options:

1. Implement cancellation now:
   - add `signal?: AbortSignal` to `SearchOptions`
   - pass it to direct-path `fetch`
   - add worker protocol message `{ type: "cancel", id }`
   - check cancellation between fetch/scoring phases
2. Or remove cancellation from public examples until implemented.

Prefer option 2 unless cancellation is needed immediately.

### 5. Runtime trusts manifest and shard JSON blindly

`fetchJson<T>()` casts parsed JSON directly to `T`. A corrupt, stale, or incompatible manifest can fail deep in query execution.

Action:

- Validate manifest at runtime on load:
  - `version`
  - `format`
  - `languages`
  - `defaultLanguage`
  - `fields`
  - shard arrays
  - relative shard paths
- Throw a clear `InvalidManifestError`.
- Keep full shard validation in build/test initially.

### 6. Shard URLs can escape the manifest origin

Shard path resolution uses `new URL(relPath, baseUrl)`. If a manifest contains an absolute URL, the client will fetch it.

Browser impact is not SSRF, but it is still a supply-chain/privacy issue if a manifest is compromised.

Action:

- Require shard file references to be relative by default.
- Add an explicit escape hatch later:

```ts
allowCrossOriginShards?: boolean;
```

- Validate this during manifest load.

## Medium-priority findings

### 7. Duplicate document IDs are not guarded

`buildIndex()` uses `source.id` directly in postings, doc store, facets, pins, and id ranges.

Duplicate IDs can silently merge postings and overwrite doc store entries.

Action:

- Reject duplicate IDs.
- Reject non-integer IDs.
- Reject negative IDs unless intentionally supported.

### 8. `buildIndex()` ignores extracted page language

`extractDocument()` reads `<html lang>`, but `buildIndex()` indexes all sources using the function-level `language` parameter.

This is acceptable for Phase 1, but it conflicts with broad multi-language positioning.

Action:

- Warn when extracted document language differs from build language.
- Later: partition by extracted language.
- Until then, document that the implemented indexer is single-language per build.

### 9. `writeIndex()` mutates the built manifest

`writeIndex()` fills `built.manifest.shards.*` and `built.manifest.pins` in-place.

Action:

- Prefer returning the final written manifest.
- Or clone the manifest before mutation.
- At minimum, document mutation explicitly.

### 10. Content-hashed JSON is not fully canonical

`writeJson()` hashes `JSON.stringify(data)`. This is deterministic for current insertion order, but not necessarily stable across independent producers.

Action:

- Sort term keys and facet values before writing.
- Add canonical JSON serialization before multiple producers become important.
- Use canonical output in spec conformance tests.

## Good parts

### Package boundaries

The package split is clean. `@csf/format` as a pure shared type package is the right mechanism to prevent client/indexer drift.

### Shared analysis path

Indexer and runtime share `analyze()` and `normalizePhrase()`. This is the correct invariant. Do not duplicate tokenization logic.

### Explicit worker URL

The explicit `workerUrl` design is correct for a library. Auto-resolving worker assets from inside a package is brittle across Vite, Webpack, esbuild, CDN, and static hosting setups.

### Facet semantics

Contextual counts use the standard rule: apply every other active filter, but not the current facet field's own filter. Good choice.

### Ranking isolation

BM25F scoring is isolated in a small function. Field boost overrides are simple and readable.

## Recommended next steps

Do these before synonyms, fuzzy matching, or expanded i18n:

1. Fix docs/API mismatch.
2. Add worker disposal and fatal error handling.
3. Evict failed shard fetches from cache.
4. Add manifest validation.
5. Validate document IDs in `buildIndex()`.
6. Either implement cancellation or remove it from docs.
7. Canonicalize JSON output.

## Suggested implementation order

### PR 1: API truthfulness

- Update `docs/07-client-api.md`.
- Add an implemented API table.
- Move future examples under explicit roadmap headings.

### PR 2: Operational hardening

- Add `SearchClient.dispose()`.
- Add worker fatal error handling.
- Fix rejected fetch caching.
- Add tests for retry-after-failure and worker failure.

### PR 3: Input and manifest validation

- Add `validateManifest()`.
- Reject absolute shard URLs by default.
- Validate source document IDs in `buildIndex()`.

### PR 4: Deterministic artifacts

- Sort object keys before writing shards.
- Add canonical JSON helper.
- Add byte-stability tests.

## Notes

The project is still early, but the foundation is better than many search libraries at this stage. Keep the core small. Do not add fuzzy/synonyms/vector support before lifecycle, validation, and API truthfulness are stable.
