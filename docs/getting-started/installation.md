# Installation

The npm and Python packages are published to GitHub Packages from `v*` release
tags. This page identifies the environment each package expects and explains
how to install them or evaluate the current implementation from the
repository.

Clone and build the TypeScript workspace with Node.js 24 and pnpm 11:

```bash
git clone https://github.com/ktjn/searchable.git
cd searchable
corepack enable
pnpm install
pnpm build
pnpm test
```

For npm, configure `@ktjn:registry=https://npm.pkg.github.com` and authenticate
with a GitHub token that has `read:packages`. For Python, add
`https://pypi.pkg.github.com/ktjn/simple/` as an additional package index and
authenticate with the same token scope. `@ktjn/searchable-client` targets
modern browsers with `fetch`, `URL`, and optional Web Worker and Service Worker
support.

The repository also contains the Python `searchable-indexer`, which generates
the index (`python/searchable-indexer`), and its shared analysis library
(`python/searchable-analysis`). Use the explicit project path for repository
development; the release artifacts are available from GitHub Packages. See
[Indexing content](../guides/indexing.md).

If vector embeddings use the built-in Transformers adapter, install its optional peer dependency in the consuming project. Lexical, facet, synonym, fuzzy, and pin searches do not require it.

See the [live feature gallery](https://ktjn.github.io/searchable/gallery/) to
evaluate generated indexes without a local build. The [First search](first-search.md)
page documents the package API.
