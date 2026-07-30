# Instructions for Claude Code

## Two client implementations

Search-behavior feature work (ranking, filters, synonyms, fuzzy matching,
pins, highlighting, etc.) should be implemented for both `packages/client`
(TypeScript) and `python/searchable-client` (Python) — they share one index
format and are expected to stay behaviorally equivalent, verified by
`python/searchable-client/tests/test_cross_implementation_conformance.py`.

## Before pushing or opening a PR

Always run `npx biome check .` (or at minimum `npx biome check <changed files>`)
and `npx vitest run <affected test files>` locally before pushing a branch or
opening a pull request. CI runs `pnpm lint` (biome) as an early, fast-failing
step — catching formatting/lint issues locally avoids a red CI run and a
follow-up fix-and-repush cycle.

Note: this repo's CI runs on Linux, but local Windows checkouts pick up
CRLF line endings (`core.autocrlf`) that make `biome check` report spurious
whole-file formatting diffs unrelated to any real change. Git normalizes
CRLF back to LF automatically on commit, so these don't actually land in
what gets pushed — but they make it hard to see genuine lint errors in the
noise. When `biome check` reports many errors, look for the specific
content diff (not just line-ending noise) before assuming everything is
pre-existing; run `git diff <file>` after `biome check --write` to confirm
only real changes are staged.
