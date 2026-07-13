# Installation

This page installs the published runtime and build-time packages and identifies the environment each package expects.

Install the browser client and the TypeScript indexer from npm:

```bash
pnpm add @ktjn/searchable-client
pnpm add -D @ktjn/searchable-indexer
```

The packages require Node.js 24 or newer for build tooling. `@ktjn/searchable-client` targets modern browsers with `fetch`, `URL`, and optional Web Worker and Service Worker support.

The repository also contains Python reference implementations. They are development and interoperability tools checked out with this project, not a `csf-indexer` package published to PyPI. Use the explicit project path when running them; see [Indexing content](../guides/indexing.md).

If vector embeddings use the built-in Transformers adapter, install its optional peer dependency in the consuming project. Lexical, facet, synonym, fuzzy, and pin searches do not require it.

Next, follow [First search](first-search.md).
