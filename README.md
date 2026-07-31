# Searchable

Searchable builds a static search index ahead of time and searches it in the browser. It provides search-service features without a query-time server, hosted API, or per-query bill. [Try the live feature gallery](https://ktjn.github.io/searchable/gallery/) to see real generated indexes searched by the browser client.

## Why Searchable

- Deploy the index beside any static site or CMS export.
- Keep user queries in the browser.
- Fetch immutable, content-hashed shards only when a query needs them.
- Use an open JSON-first index format built by the Python `searchable-indexer` and read by the TypeScript client, or by the Python `searchable-client` (`python/searchable-client/`) for CLI and backend-service use — see its [README](python/searchable-client/README.md) and the [Python client API reference](docs/reference/python-client-api.md).
- Add richer search without adopting an application framework.

## What it supports

- BM25F lexical ranking, field and document boosts, prefix queries, quoted phrases, and fuzzy matching
- Terms, range, and hierarchical facets with contextual counts
- Query-time synonyms and editorial term-to-page pins
- English, German, Swedish, Dutch, Bokmål, and Nynorsk analysis plus fallback segmenters for CJK and Southeast Asian scripts
- Web Worker execution, cancellation, streaming partial results, highlighting, and lifecycle events
- Service Worker caching for offline search
- Optional binary term, fuzzy, and document-store shards
- Vector and hybrid search with injectable embeddings or the optional Transformers integration

## Public preview

The npm packages are published to GitHub Packages and the Python packages to
PyPI from `v*` release tags. Configure the package registries before installing
them, or evaluate the
implemented search surfaces in the [live feature gallery](https://ktjn.github.io/searchable/gallery/):

Before releasing, add the PyPI API token as the `PYPI_API_TOKEN` secret for the
`pypi` GitHub environment.

The Python `searchable-client` also supports injected vector and hybrid query
embeddings without bundling a model runtime; see the [Python client API
reference](docs/reference/python-client-api.md).

```bash
git clone https://github.com/ktjn/searchable.git
cd searchable
corepack enable
pnpm install
pnpm build
pnpm test
```

For npm, add `@ktjn:registry=https://npm.pkg.github.com` to `.npmrc` and provide
a GitHub token with `read:packages`. Python packages are installed from the
standard PyPI index:

```bash
uv add searchable-indexer searchable-analysis searchable-client
```

### API shape

The package API builds and publishes an index, then creates a client
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

The index generator (`python/searchable-indexer`, which discovers and analyzes source documents and writes the manifest and shards) and its shared analysis library (`python/searchable-analysis`) are Python projects that use `uv` for development. Contributions should preserve deterministic output; see [Project governance](docs/project/governance.md).

See [Contributing](CONTRIBUTING.md) before opening a pull request and report
security issues through the private process in [Security](SECURITY.md).

## Status

The implemented package surface is released from `v*` tags to GitHub Packages.
The lexical, facet, synonym, fuzzy,
pinning, worker, offline, binary-storage, and vector/hybrid surfaces described
in these docs are implemented. Planned work is collected only in the
[roadmap](docs/project/roadmap.md); historical investigations and superseded
specifications live under `docs/archive/`.

## License

[MIT](LICENSE)
