# Searchable

Searchable builds a static search index ahead of time and searches it in the browser. It provides search-service features without a query-time server, hosted API, or per-query bill. [Try the live feature gallery](https://ktjn.github.io/searchable/gallery/) to see real generated indexes searched by the browser client.

## Why Searchable

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

## Public preview

The npm and Python packages are not yet published. Evaluate the implemented
search surfaces in the [live feature gallery](https://ktjn.github.io/searchable/gallery/)
or work with the repository directly:

```bash
git clone https://github.com/ktjn/searchable.git
cd searchable
corepack enable
pnpm install
pnpm build
pnpm test
```

The package manifests are prepared for a coordinated first npm release at
`1.0.0`. Until that release exists, do not use the package names in production
installation commands.

### API shape

The planned package API builds and publishes an index, then creates a client
that points at its manifest:

```ts
import { SearchClient } from "@ktjn/searchable-client";

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

## Development

Requires Node.js 24 or newer and pnpm 11.

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

Python reference implementations live in `python/searchable-analysis` and `python/searchable-indexer` and use `uv` for development. Contributions should preserve deterministic output and cross-implementation conformance; see [Project governance](docs/project/governance.md).

See [Contributing](CONTRIBUTING.md) before opening a pull request and report
security issues through the private process in [Security](SECURITY.md).

## Status

The implemented package surface is prepared for a planned first npm release at
`1.0.0`, but it is not yet published. The lexical, facet, synonym, fuzzy,
pinning, worker, offline, binary-storage, and vector/hybrid surfaces described
in these docs are implemented. Planned work is collected only in the
[roadmap](docs/project/roadmap.md); historical investigations and superseded
specifications live under `docs/archive/`.

## License

[MIT](LICENSE)
