# Installation

The npm package is published to GitHub Packages and the Python package to
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

Install the TypeScript client from GitHub Packages:

```bash
pnpm add @ktjn/searchable
```

Configure `@ktjn:registry=https://npm.pkg.github.com` in `.npmrc` and authenticate
with a GitHub token that has `read:packages`.

Install the Python client from PyPI:

```bash
uv add searchable
```

`@ktjn/searchable` targets modern browsers with `fetch` and `URL`.

The Python package contains the index builder, synchronous client, and shared
analysis code. Its repository project lives at `python/searchable`; the
installed `searchable` command exposes `build`, `query`, and `facet` commands.
Use the explicit project path for repository development.
PyPI publication uses the `PYPI_API_TOKEN` secret in this repository's `pypi`
environment. See [Indexing content](../guides/indexing.md).

See the [live feature gallery](https://ktjn.github.io/searchable/gallery/) to
evaluate generated indexes without a local build. The [First search](first-search.md)
page documents the package API.
