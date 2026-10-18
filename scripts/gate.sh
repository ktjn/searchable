#!/usr/bin/env bash
# Local test gate. Runs from the pre-push hook (.githooks/pre-push) and by
# hand via `pnpm gate`. GitHub CI only builds; every test runs here.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

step() { printf '\n==> %s\n' "$*"; }

step "Install workspace dependencies (frozen lockfile)"
pnpm install --frozen-lockfile

step "Lint (biome)"
pnpm lint

step "Python: sync, ruff, mypy, pytest"
(
  cd python/searchable
  uv sync
  uv run ruff check .
  uv run ruff format --check .
  uv run mypy src
  uv run pytest -q
)

step "Build packages + showcase"
pnpm build
pnpm --filter showcase build

step "Typecheck"
pnpm typecheck

step "Bundle size"
pnpm size

step "Unit tests (vitest)"
pnpm test

step "Browser tests (playwright)"
pnpm test:browser

printf '\nGate passed.\n'
