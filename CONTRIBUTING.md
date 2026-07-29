# Contributing to Searchable

Searchable welcomes focused fixes, documentation improvements, and features
that solve a concrete consumer problem. The npm and Python packages are not yet
published, so contributions currently target the repository and live showcase.

## Development setup

Install Node.js 24 or newer and enable the pnpm version declared in
`package.json`:

```bash
corepack enable
pnpm install
pnpm build
pnpm test
```

The index generator (`python/searchable-indexer`) and its shared analysis
library (`python/searchable-analysis`) are Python projects that use `uv`.
Run their suites from the corresponding project directories:

```bash
cd python/searchable-analysis
uv sync
uv run pytest -v

cd ../searchable-indexer
uv sync
uv run pytest -v
```

## Before opening a pull request

Run the narrowest relevant tests while developing, then run the applicable
repository gates:

```bash
pnpm lint
pnpm typecheck
pnpm size
pnpm test
pnpm test:browser
```

Browser tests require Chromium; install it with
`pnpm exec playwright install --with-deps chromium` when needed.

Keep generated index output, package tarballs, local environments, and other
artifacts out of commits. Explain the commands you ran and their results in the
pull request.

## Compatibility and documentation

- Preserve deterministic output across repeated builds.
- Keep the index format and analysis behavior consistent between
  `searchable-indexer` and the TypeScript client that reads its output when
  changing either.
- Add focused behavior coverage for every change.
- Update public documentation with public API, configuration, or workflow
  changes.
- Record architecture decisions in an ADR when they change a durable product
  boundary; small implementation choices belong in code and tests.
- Keep pull requests focused so compatibility and performance effects are
  reviewable.

See [Project governance](docs/project/governance.md) and
[Compatibility](docs/reference/compatibility.md) for the full policies.

## Security reports

Do not report suspected vulnerabilities in a public issue. Follow
[Security](SECURITY.md) instead.
