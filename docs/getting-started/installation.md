# Installation

The npm packages are published to GitHub Packages and the Python packages to
PyPI from `v*` release tags. This page identifies the environment each package
expects and explains
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
with a GitHub token that has `read:packages`. Python packages install from the
standard PyPI index. `@ktjn/searchable-client` targets
modern browsers with `fetch`, `URL`, and optional Web Worker support.

The repository also contains the Python `searchable-indexer`, which generates
the index (`python/searchable-indexer`), and its shared analysis library
(`python/searchable-analysis`). Use the explicit project path for repository
development; the release artifacts are available from GitHub Packages and PyPI.
PyPI publication uses the `PYPI_API_TOKEN` secret in this repository's `pypi`
environment. See
[Indexing content](../guides/indexing.md).

See the [live feature gallery](https://ktjn.github.io/searchable/gallery/) to
evaluate generated indexes without a local build. The [First search](first-search.md)
page documents the package API.
