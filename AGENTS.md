# Instructions for Claude Code

## System specification

This repo is onboarded to [system-spec](https://github.com/ktjn/system-specification)
(brownfield Level 3 — release) at `spec/system.yaml`; the exported toolkit
snapshot lives in `system-spec/`. Follow `system-spec/CONSTITUTION.md` plus
`system-spec/BROWNFIELD.md` for any further adoption work. The intake/gate
record is at `spec/INTAKE.md`.

* `spec/system.yaml` must validate before committing:
  `system-spec spec/system.yaml --stage release`
* For a bounded AI context slice: `system-spec spec/system.yaml --context <component-id>`
* Report model gaps or hidden coupling as feedback
  (`system-spec/CONSTITUTION.md` § Self-Improvement and Model Feedback)

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
