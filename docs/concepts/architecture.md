# Architecture

This page describes the shipped build-time and browser-runtime components, their data flow, and the decisions that keep the system static and framework-independent.

## Build time

The Python `searchable` package (`python/searchable`, module
`searchable.indexer`) discovers rendered HTML, extracts
title/body/language/CMS controls, runs shared analysis, and builds postings,
facets, pins, synonyms, fuzzy dictionaries, and stored documents. It writes an
immutable manifest and content-hashed shards. It is a build-time tool, not a
runtime dependency of the TypeScript package, which only reads its output.

## Query time

`@ktjn/searchable` validates the manifest, resolves all shard files relative to it, analyzes the query, fetches only the required data, evaluates filters and ranking, and loads stored fields for the final hits.

A second, independent client implementation, `searchable` (Python,
`python/searchable/`, module `searchable.client`), reads the exact same manifest/shard contract
for CLI and backend-service use. Feature work on search behavior
(ranking, filtering, synonyms, fuzzy matching, etc.) should consider both
clients, not just the TypeScript one — see
[Python client API](../reference/python-client-api.md).

The shared cases in `spec/fixtures/client-conformance/` run against one
Python-built index through both clients. Their normalized observable results
must agree.

## Data flow for a query

```text
rendered HTML -> indexer -> manifest + content-hashed shards -> static host
                                                               |
                                                               +-- query -> SearchClient (TypeScript) -> analysis -> lazy shard fetch -> ranking -> hits
                                                               |
                                                               +-- query -> SearchClient (Python) -> analysis -> lazy shard fetch -> lexical ranking -> hits
```

## Deployment topology

The generated directory lives beside the static site or on an allowed CDN. The browser needs only the manifest URL.

The browser client uses TypeScript, Vite, Vitest, and Playwright and has no
application-framework dependency. The client performs plain HTTP GETs and
never requires a query-time write path or backend.

The public API stays small while optional costs are gated by use. Facets, synonyms, pins, and fuzzy logic are bundled but inert until requested. Dynamic third-party plugin registration is not implemented and is tracked only in the [roadmap](../project/roadmap.md).

Accepted decisions are summarized in
[Architecture decisions](../project/architecture-decisions.md).
