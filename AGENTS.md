# Instructions for Claude Code

## Required gates before pushing or opening a PR

Always run `npx biome check .` (or at minimum `npx biome check <changed files>`)
and `npx vitest run <affected test files>` locally before pushing a branch or
opening a pull request. CI runs `pnpm lint` (biome) as an early, fast-failing
step — catching formatting/lint issues locally avoids a red CI run and a
follow-up fix-and-repush cycle.

Before creating a PR, also run the Python client gates from
`python/searchable-client/`. The Ruff checks are mandatory and must not be
skipped:

```bash
uv sync
uv run ruff check .
uv run ruff format --check .
uv run mypy src
uv run pytest -v
```

The PR must not be created until both Ruff commands pass. These are the same
commands CI runs in the Python client job.

Note: this repo's CI runs on Linux, but local Windows checkouts pick up
CRLF line endings (`core.autocrlf`) that make `biome check` report spurious
whole-file formatting diffs unrelated to any real change. Git normalizes
CRLF back to LF automatically on commit, so these don't actually land in
what gets pushed — but they make it hard to see genuine lint errors in the
noise. When `biome check` reports many errors, look for the specific
content diff (not just line-ending noise) before assuming everything is
pre-existing; run `git diff <file>` after `biome check --write` to confirm
only real changes are staged.
