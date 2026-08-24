# Contributing to Searchable

Searchable welcomes focused fixes, documentation improvements, and features
that solve a concrete consumer problem. The repository publishes one npm
package and one Python package, so changes should keep their shared search
contract aligned.

## Development setup

Install Node.js 24 or newer and enable the pnpm version declared in
`package.json`:

```bash
corepack enable
pnpm install
pnpm build
pnpm test
```

The consolidated Python toolkit lives at `python/searchable` and uses `uv`:

```bash
cd python/searchable
uv sync
uv run ruff check .
uv run ruff format --check .
uv run mypy src
uv run pytest -v
```

## Before opening a pull request

Run focused tests while developing, then run the applicable repository gates:

```bash
pnpm lint
pnpm typecheck
pnpm size
pnpm test
pnpm test:browser
```

Browser tests require Chromium. Install it with
`pnpm exec playwright install --with-deps chromium` when needed.

Keep generated indexes, package archives, virtual environments, caches, and
other local artifacts out of commits. Explain the commands you ran and their
results in the pull request.

## Compatibility and documentation

- Preserve deterministic output across repeated builds.
- Keep TypeScript and Python search behavior aligned; extend the shared
  client-conformance fixtures when changing their common contract.
- Keep the Python index builder and both clients compatible with the documented
  manifest version.
- Add focused behavior coverage for every change.
- Update public documentation with public API, configuration, or workflow
  changes.
- Record durable product-boundary changes in an ADR; keep local implementation
  choices in code and tests.
- Keep pull requests focused enough for compatibility and performance effects
  to remain reviewable.

See [Project governance](docs/project/governance.md) and
[Compatibility](docs/reference/compatibility.md) for the full policies.

## Security reports

Do not report suspected vulnerabilities in a public issue. Follow
[Security](SECURITY.md) instead.
