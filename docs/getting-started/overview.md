# Overview

This page explains when client-side static search fits and how the framework divides build-time and query-time responsibilities.

Searchable is for documentation, marketing sites, product catalogs, and other mostly static corpora that need capable search without a query-time backend. An indexer extracts HTML and writes an immutable manifest plus shards. `@ktjn/searchable-client` loads that manifest and searches the required shards in the browser.

The approach is a good fit when content can be rebuilt and published, the index can be served over static HTTP, and keeping queries local is useful. It is not a replacement for real-time database search, access-controlled per-user results, or a server-side analytics pipeline.

Core properties:

- search data is open, deterministic, and independently producible;
- network and computation costs are paid by the static build and browser, not a search service;
- JSON is the default storage format, with binary encodings available for measured hot paths;
- the same public API works on the main thread or in a Web Worker;
- optional feature data is loaded only when needed.

Continue with [Installation](installation.md), then build the example in [First search](first-search.md). The architectural boundary is documented in [Architecture](../concepts/architecture.md).
