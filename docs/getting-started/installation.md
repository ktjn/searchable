# Installation

The npm and Python packages are not yet published. This page identifies the
environment each package expects and explains how to evaluate the current
implementation from the repository.

Clone and build the TypeScript workspace with Node.js 24 and pnpm 11:

```bash
git clone https://github.com/ktjn/searchable.git
cd searchable
corepack enable
pnpm install
pnpm build
pnpm test
```

The package manifests are prepared for a coordinated first npm release at
`1.0.0`. Until that release exists, the repository workspace is a development
and interoperability surface rather than a supported production installation
method. `@ktjn/searchable-client` targets modern browsers with `fetch`, `URL`,
and optional Web Worker and Service Worker support.

The repository also contains Python reference implementations. They are development and interoperability tools checked out with this project, not a `searchable-indexer` package published to PyPI. Use the explicit project path when running them; see [Indexing content](../guides/indexing.md).

If vector embeddings use the built-in Transformers adapter, install its optional peer dependency in the consuming project. Lexical, facet, synonym, fuzzy, and pin searches do not require it.

See the [live feature gallery](https://ktjn.github.io/searchable/gallery/) to
evaluate generated indexes without a local build. The [First search](first-search.md)
page documents the planned package API.
