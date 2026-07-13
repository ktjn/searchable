# client-search-framework

`client-search-framework` builds a static search index ahead of time and searches it in the browser. It provides search-service features without a query-time server, hosted API, or per-query bill.

## Why client-search-framework

- Deploy the index beside any static site or CMS export.
- Keep user queries in the browser.
- Fetch immutable, content-hashed shards only when a query needs them.
- Use an open JSON-first index format with independent TypeScript and Python producers.
- Add richer search without adopting an application framework.

## What it supports

- BM25F lexical ranking, field and document boosts, prefix queries, quoted phrases, and fuzzy matching
- Terms, range, and hierarchical facets with contextual counts
- Query-time synonyms and editorial term-to-page pins
- English and German analysis plus fallback segmenters for CJK and Southeast Asian scripts
- Web Worker execution, cancellation, streaming partial results, highlighting, and lifecycle events
- Service Worker caching for offline search
- Optional binary term, fuzzy, and document-store shards
- Vector and hybrid search with injectable embeddings or the optional Transformers integration

## Quick start

```bash
pnpm add @csf/client
pnpm add -D @csf/indexer
```

Build and publish an index, then create a client that points at its manifest:

```ts
import { SearchClient } from "@csf/client";

const search = new SearchClient({
  indexUrl: "/search-index/manifest.json",
  worker: true,
  workerUrl: new URL("/assets/worker.js", location.href),
});

const result = await search.search("getting started");
for (const hit of result.hits) {
  console.log(hit.fields.title, hit.url);
}
```

See [First search](docs/getting-started/first-search.md) for a complete path and [Indexing content](docs/guides/indexing.md) for index production.

## Documentation

- [Overview](docs/getting-started/overview.md)
- [Installation](docs/getting-started/installation.md)
- [Guides](docs/guides/indexing.md)
- [Architecture](docs/concepts/architecture.md)
- [Client API](docs/reference/client-api.md)
- [Configuration](docs/reference/configuration.md)
- [Roadmap](docs/project/roadmap.md)

## Showcase

The `showcase/` application builds the public documentation search and feature gallery. Run `pnpm --filter showcase build` to generate it locally.

## Development

Requires Node.js 20 or newer and pnpm 11.

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

Python reference implementations live in `python/csf-analysis` and `python/csf-indexer` and use `uv` for development. Contributions should preserve deterministic output and cross-implementation conformance; see [Project governance](docs/project/governance.md).

## Status

The published package API is `1.0.0`. The lexical, facet, synonym, fuzzy, pinning, worker, offline, binary-storage, and vector/hybrid surfaces described in these docs are implemented. Planned work is collected only in the [roadmap](docs/project/roadmap.md); historical investigations and superseded specifications live under `docs/archive/`.

## License

[MIT](LICENSE)
