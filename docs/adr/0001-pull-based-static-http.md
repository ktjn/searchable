# ADR-0001: Pull-based static HTTP transport, no query-time backend

## Status

Accepted (implemented since Phase 1, `packages/indexer`/`packages/client`).

## Context

The core problem statement ([getting-started/overview.md](../getting-started/overview.md)) is
search-service quality without a search service: no per-query
infrastructure, no hosted API, no query-time billing. That requires
picking, once, how the runtime gets index data at all — a query-time API
server, a database the browser talks to directly, or files fetched over
plain HTTP.

## Decision

The indexer runs offline and emits an immutable, content-hashed set of
static files (manifest + shards, [concepts/index-format.md](../concepts/index-format.md)).
The browser runtime (`@ktjn/searchable-client`) only ever issues plain `fetch()` GET
requests against whatever static host serves those files, lazily
fetching just the shards a given query touches. There
is no query-time write path, no server-side logic, and no protocol
beyond HTTP GET + standard cache headers.

## Alternatives Considered

- **A query-time API server** (Algolia/Typesense-style): rejected as the
  thing this project exists to avoid — it reintroduces the
  infrastructure, latency-to-a-third-party, and per-query cost this
  project's entire value proposition is not having.
- **A browser-embedded database synced wholesale** (e.g. ship a SQLite/
  DuckDB file and query it client-side): rejected because it requires
  downloading the *entire* corpus before the first query, which
  [concepts/architecture.md](../concepts/architecture.md)'s
  "lazy resource loading" principle and the sharding design in
  [concepts/index-format.md](../concepts/index-format.md) specifically exist to
  avoid at scale.

## Consequences

- No incremental/real-time index mutation from the browser — any
  content change means a full rebuild + republish
  (an accepted non-feature in the [roadmap](../project/roadmap.md)).
- Every deployment concern reduces to "can this host serve static files
  with the right cache headers," which is true of nearly any host —
  this is what keeps the [index deployment guidance](../guides/indexing.md)
  short.
- The index format has to be a documented, storage-format-independent
  spec rather than an internal implementation detail, since a static
  host has no query-time process to hide format details behind — see
  ADR-0002.
