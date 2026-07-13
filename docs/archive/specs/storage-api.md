# Storage API Specification

Status: Draft — listed in [23-implementation-roadmap.md](23-implementation-roadmap.md)'s
Phase 1 and [24-architecture-recommendations.md](24-architecture-recommendations.md)'s
item 4 as the spec to write for this; both now point here rather than
restating its contents.

## Purpose

The Storage API defines the abstraction between the search engine and the physical storage of index data.

The query planner and executor must not know:

- where data is stored
- how it is transported
- whether data is cached
- whether data is JSON or binary

Their dependency is the Storage API.

## Goals

- Transport independence
- Storage independence
- Lazy loading
- Cache-friendly operation
- Offline capability
- Browser-first behavior
- Deterministic query results

## Architecture

Search Engine
→ IndexStorage
→ Storage backend

Storage backends may include:

- HTTP
- IndexedDB
- Service Worker Cache
- File System API
- Node.js
- Electron

## Responsibilities

The storage layer is responsible for:

- loading manifests
- locating shards
- downloading data
- decoding physical files
- cache management
- version validation
- retry policies
- offline support
- lifecycle management

The storage layer is not responsible for:

- query planning
- ranking
- tokenization
- scoring
- facet computation
- highlighting

## Core Interface

The API should remain intentionally small.

```ts
interface IndexStorage {
  loadManifest(): Promise<Manifest>;
  loadTermShard(ref: ShardRef): Promise<TermShard>;
  loadFacetShard(ref: ShardRef): Promise<FacetShard>;
  loadDocumentShard(ref: ShardRef): Promise<DocumentShard>;
  loadPinsShard(ref: ShardRef): Promise<PinsShard>;
}
```

The concrete shard shape may be JSON-backed or binary-backed. The executor should receive logical shard objects or logical shard readers, not raw transport data.

## Shard References

Shard references should contain the information required to load and validate a shard.

```ts
interface ShardRef {
  id: string;
  type: "terms" | "facets" | "docs" | "pins" | "synonyms";
  format: "json" | "binary";
  file: string;
  hash?: string;
  version?: number;
  compressed?: boolean;
}
```

Shard paths should be relative by default. Cross-origin shards require an explicit opt-in.

## Optional Capabilities

Storage implementations may expose optional capabilities.

```ts
interface PrefetchCapableStorage {
  prefetch(refs: ShardRef[]): Promise<void>;
}

interface DisposableStorage {
  dispose(): void | Promise<void>;
}

interface ObservableStorage {
  stats(): StorageStats;
}
```

Optional capabilities must not be required for correctness.

## HTTP Storage

HTTP storage is the reference implementation.

Characteristics:

- uses `fetch()`
- serves immutable content-hashed shard files
- relies on browser and CDN caching
- supports HTTP compression
- works with static hosting

HTTP storage should support:

- `ETag`
- `Cache-Control`
- immutable assets
- request deduplication
- failed-request eviction from memory caches

## IndexedDB Storage

IndexedDB storage supports offline search.

Typical flow:

1. Download manifest and shards.
2. Persist them locally.
3. Query from IndexedDB.
4. Refresh in the background.

The query engine must not know whether data came from HTTP or IndexedDB.

## Service Worker Storage

Service Worker storage may provide:

- offline support
- background synchronization
- transparent cache population
- stale-while-revalidate behavior

Service Worker behavior must preserve deterministic search results for a given manifest version.

## File System Storage

File system storage supports:

- local documentation
- Electron applications
- Node.js tools
- test fixtures

The same logical `IndexStorage` contract applies.

## Cache Ownership

Only the storage implementation owns caches.

The query planner and executor should not cache raw shards directly.

Benefits:

- single cache owner
- easier invalidation
- transport independence
- consistent retry behavior

The executor may keep short-lived query-local data structures, but not long-lived storage caches.

## Lazy Loading

Storage implementations should load:

- manifest during initialization
- dictionary or term shards on demand
- postings only for matching terms when the format supports it
- facet shards only when filtering or computing facets
- document shards only for final hits

Avoid eager loading unless explicitly requested.

## Prefetching

Prefetching is a hint.

It may load:

- likely term shards
- popular facet shards
- adjacent dictionary blocks
- document shards for top pages

Prefetching must never change search semantics.

## Concurrency

Storage implementations should:

- deduplicate concurrent loads for the same shard
- avoid duplicate downloads
- support cancellation where possible
- avoid permanent caching of failed requests
- protect against unbounded parallel fetches

## Error Handling

Storage should distinguish:

- network failures
- missing shards
- corrupted data
- unsupported versions
- incompatible manifests
- checksum mismatches
- decode failures

Errors should be descriptive and typed.

Recommended error types:

- `IndexNotFoundError`
- `ShardNotFoundError`
- `InvalidManifestError`
- `UnsupportedIndexVersionError`
- `ShardDecodeError`
- `ChecksumMismatchError`
- `StorageUnavailableError`

## Version Validation

Storage validates:

- manifest version
- shard version
- binary format version
- declared checksums
- required capabilities

Execution should never receive incompatible data.

## Security Considerations

Storage implementations must validate:

- shard paths
- origin policy
- content type where meaningful
- expected size where declared
- checksums where declared
- binary offsets and bounds
- UTF-8 validity where applicable

Malformed data must fail closed.

## Determinism

For the same manifest and same query, all storage implementations must return identical logical data.

Storage may affect:

- latency
- memory usage
- bandwidth
- offline availability

Storage must not affect:

- matching
- scoring
- ranking
- facet counts
- result shape

## Testing Requirements

Every storage implementation should pass the same conformance suite.

Tests should cover:

- manifest loading
- shard loading
- request deduplication
- cache invalidation
- retry after failed request
- offline behavior
- cancellation
- corrupted data
- unsupported versions
- checksum mismatch
- deterministic search equivalence

## Success Criteria

The search engine must produce identical results regardless of storage backend.

The Storage API succeeds when HTTP, IndexedDB, Service Worker, File System, Node and Electron backends can be implemented without changing the query planner or executor.