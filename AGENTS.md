# Instructions for Claude Code

## Before pushing or opening a PR

GitHub CI only builds (lint, package + showcase build, typecheck, Python
`uv build`). All tests run locally through `scripts/gate.sh` (`pnpm gate`):
frozen install, biome, ruff/mypy/pytest, build, typecheck, bundle size,
vitest, and Playwright. The `.githooks/pre-push` hook runs the same gate
before every push; `pnpm install` enables it via `core.hooksPath`. Do not
bypass it with `--no-verify`. Report the gate result in the PR.

Note: this repo's CI runs on Linux, but local Windows checkouts pick up
CRLF line endings (`core.autocrlf`) that make `biome check` report spurious
whole-file formatting diffs unrelated to any real change. Git normalizes
CRLF back to LF automatically on commit, so these don't actually land in
what gets pushed — but they make it hard to see genuine lint errors in the
noise. When `biome check` reports many errors, look for the specific
content diff (not just line-ending noise) before assuming everything is
pre-existing; run `git diff <file>` after `biome check --write` to confirm
only real changes are staged.
