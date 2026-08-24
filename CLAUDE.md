# Instructions for Claude Code

## Two client implementations

Search-behavior feature work (ranking, filters, synonyms, fuzzy matching,
pins, highlighting, etc.) should be implemented for both `packages/searchable`
(TypeScript) and `python/searchable` (Python, `searchable.client`) — they
share one index format and are intended to stay behaviorally equivalent.

`packages/searchable/test/client-conformance.test.ts` builds one index with the
Python builder, runs the shared cases in `spec/fixtures/client-conformance/`
through both clients, and compares normalized results. Extend that matrix for
every retained behavior exposed by both runtimes.

`python/searchable/tests/test_cross_implementation_conformance.py` serves a
different purpose: it verifies that the Python client remains generator-
agnostic by comparing indexes from the real builder and the independent
reference generator in `spec/examples/python/`.

## Release flow

Cutting a release is a three-workflow chain (`release-prep.yml` →
`release-tag.yml` → `publish.yml`) where each step's trigger depends on the
previous step producing a specific event, not a checked state — see
[docs/project/release-process.md](docs/project/release-process.md) for the
full mechanics. **A tag existing, or a `Release X.Y.Z` PR being merged, is
not proof a release actually published.** The tag-push → `publish.yml`
handoff has silently failed before (tag pushed fine, zero downstream
workflow run, no GitHub Release, nothing published) with no visible error.
Before treating a release as done, or before starting a new one, check
`gh release list` and `gh run list --workflow=publish.yml` — don't infer
success from the tag or PR alone. If the chain stalls after tagging,
`publish.yml` has a `workflow_dispatch` fallback: `gh workflow run
publish.yml --ref vX.Y.Z`.

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
