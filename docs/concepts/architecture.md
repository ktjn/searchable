# Architecture

This page describes the shipped build-time and browser-runtime components, their data flow, and the decisions that keep the system static and framework-independent.

## Build time

`@ktjn/searchable-indexer` discovers rendered HTML, extracts title/body/language/CMS controls, runs shared analysis, and builds postings, facets, pins, synonyms, fuzzy dictionaries, stored documents, and optional vectors. `writeIndex` serializes an immutable manifest and content-hashed shards. The Python projects are independent reference producers for conformance, not runtime dependencies of the TypeScript packages.

## Query time

`@ktjn/searchable-client` validates the manifest, resolves all shard files relative to it, analyzes the query, fetches only the required data, evaluates filters and ranking, and loads stored fields for the final hits. The same search code runs directly or behind `@ktjn/searchable-client/worker`. Optional Service Worker support caches the manifest and shards.

## Data flow for a query

```text
rendered HTML -> indexer -> manifest + content-hashed shards -> static host
                                                               |
query -> SearchClient -> analysis -> lazy shard fetch -> ranking -> hits
```

## Deployment topology

The generated directory lives beside the static site or on an allowed CDN. The browser needs only the manifest URL plus optional worker and Service Worker script URLs.

The core uses TypeScript, Vite, Vitest, and Playwright and has no application-framework dependency. Analysis and format shapes are shared workspace packages. The client performs plain HTTP GETs and never requires a query-time write path or backend.

The public API stays small while optional costs are gated by use. Facets, synonyms, pins, and fuzzy logic are bundled but inert until requested; large embedding support is a lazy optional dependency. Dynamic third-party plugin registration is not implemented and is tracked only in the [roadmap](../project/roadmap.md).

The five accepted decisions are summarized in [Architecture decisions](../project/architecture-decisions.md).
