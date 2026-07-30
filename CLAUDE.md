# Instructions for Claude Code

## Two client implementations

Search-behavior feature work (ranking, filters, synonyms, fuzzy matching,
pins, highlighting, etc.) should be implemented for both `packages/client`
(TypeScript) and `python/searchable-client` (Python) — they share one index
format and are intended to stay behaviorally equivalent.

`python/searchable-client/tests/test_cross_implementation_conformance.py`
does **not** verify that equivalence: it only proves the Python client is
generator-agnostic, i.e. it returns equivalent results whether the index it
queries was built by the real `searchable-indexer` or by the independent
`spec/examples/python/generate_index.py` reference generator — both Python,
both feeding the same Python client. It contains no TypeScript client
invocation and cannot detect a genuine TS-vs-Python behavioral divergence.
A real cross-language (TS-client-vs-Python-client) parity harness is
tracked as follow-up work, not yet implemented — the original TS index
generator this repo's client tests once used for that purpose was removed
in an earlier, unrelated change (#61).

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
