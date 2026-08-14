# Release process

How a version gets from "merged to `main`" to "published on npm / PyPI with a
GitHub Release." Three workflows form a chain; each one's trigger depends on
the previous one producing a specific side effect. That handoff is the part
that has repeatedly broken (see [Known failure mode](#known-failure-mode-tag-push-doesnt-trigger-publish)
below) — read this before assuming a release "went out" just because a tag
or a merged PR exists.

## The chain

1. **`release-prep.yml`** (`workflow_dispatch`, manual: "Run workflow" with a
   version input). Bumps every npm manifest and Python `pyproject.toml` to one
   aligned version (`.github/scripts/prepare_release.py`), freezes the
   `## [Unreleased]` changelog section into a dated release section, and opens
   a `Release X.Y.Z` PR (optionally with auto-merge).

2. **`release-tag.yml`** (`pull_request: types: [closed]`, filtered to
   `merged == true` and a `Release X.Y.Z` title). When the release PR merges,
   this pushes an annotated `vX.Y.Z` tag to `main`.

3. **`publish.yml`** (`push: tags: "v*"`). Re-runs full CI (`run-all: true`,
   bypassing the changed-paths filter), then creates the GitHub Release,
   builds and publishes the npm package to GitHub Packages, and builds,
   smoke-tests, and publishes the Python package to PyPI.

Each step's trigger is an *event*, not a state check — nothing re-verifies
that step 3 actually ran after step 2 finishes. A tag can exist with no
corresponding GitHub Release and no published packages, and nothing will
flag that on its own. Always confirm a release completed by checking
`gh release list` and the registries, not just that the tag exists.

## Known failure mode: tag push doesn't trigger `publish.yml`

GitHub does not fire downstream workflow triggers for pushes made with the
default `GITHUB_TOKEN` — this is documented, intentional loop-prevention.
`release-tag.yml` works around it by pushing the tag with `RELEASE_TOKEN` (a
PAT/App token) instead of `GITHUB_TOKEN`, specifically so the `v*` push event
reaches `publish.yml`.

That workaround is not fully reliable. On 2026-08-13, tagging `v2.0.1`
pushed the tag successfully (confirmed in the `release-tag` job log) using
`RELEASE_TOKEN`, but **no `publish.yml` run was ever created** — no check
suite, no workflow run, nothing — even though the identical mechanism had
worked four days earlier for `v1.4.1`. The failure was silent: the release
PR was merged, the tag existed, and nothing in the UI indicated the release
never shipped. It was only caught by manually cross-referencing
`gh release list` (still showing `v1.4.1` as latest) against the tag list.

The exact trigger-suppression cause wasn't conclusively identified (GitHub
doesn't expose enough about *why* a push didn't dispatch a workflow via the
API) — treat `RELEASE_TOKEN`-pushed tags as "probably but not certainly"
sufficient to trigger publishing, not a guarantee.

**Recovery:** `publish.yml` also accepts `workflow_dispatch`, added as a
manual fallback for exactly this situation. To (re-)publish an existing tag:

```
gh workflow run publish.yml --ref vX.Y.Z
```

Dispatching against the tag ref sets `github.ref`/`github.ref_name` to that
tag, so every downstream step (release notes, package builds) behaves
identically to a real tag-push trigger.

**If that also doesn't work** (e.g. the tag predates the `workflow_dispatch`
addition, so that ref's copy of `publish.yml` doesn't declare the trigger):
delete and re-push the tag using your own authenticated `git push` (a real
user push is never subject to the `GITHUB_TOKEN` suppression, unlike the
Actions-bot-driven push in `release-tag.yml`). Only do this when you've
independently confirmed (via `gh release list` and the registries) that the
tag's version was never actually published — re-publishing a version that
already shipped will fail loudly at the registry (PyPI/npm reject
re-uploads of an existing version) or, worse, silently diverge if a partial
publish happened. Re-tagging is not something to reach for reflexively.

## For agents

- Don't infer "released" from "tag exists" or "release PR merged." Check
  `gh release list` and, if relevant, the actual package registries.
- If asked to cut a release and the standard `release-prep.yml` →
  `release-tag.yml` chain runs but no `publish.yml` run shows up afterward
  (check `gh run list --workflow=publish.yml`), that's this failure mode —
  use the `workflow_dispatch` recovery above rather than assuming something
  else is wrong or re-running `release-prep.yml` from scratch.
- Never re-publish a version that a registry already has; if a tag's publish
  is genuinely stuck (not just slow), verify via the registries before
  re-tagging.
