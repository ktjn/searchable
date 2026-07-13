# 2026-07-13 GitHub Actions consolidation design

## Goal

Make the repository's three GitHub Actions workflows smaller and easier to
maintain without weakening pull-request, release, or publishing checks. Use
Node.js 24 LTS and Python 3.14 in CI, remove Playwright from the GitHub Pages
deployment path, and retain the complete browser gate before npm publication.

The package support policy changes only for Node.js: the documented and
declared minimum becomes Node.js 24. Python 3.14 is the CI interpreter, while
the two Python packages continue to support Python 3.10 and newer as declared
in their package metadata.

## Current problems

The CI, Pages, and npm publishing workflows each repeat pnpm, Node.js, cache,
and dependency-installation steps. Python setup is also repeated, but the
publishing workflow omits `uv` even though the JavaScript test suite includes
a TypeScript/Python conformance test that requires it.

The Pages workflow runs the complete `docs:check` command, including
Playwright installation and browser tests, after the same revision has already
passed CI. Pages only needs to build and validate the static artifact before
uploading it. The npm publishing workflow should retain the full gate, but it
should consume that gate instead of maintaining a second copy.

## Responsibility boundaries

Each workflow has one primary responsibility:

- `.github/workflows/ci.yml` defines the authoritative verification gate;
- `.github/workflows/deploy-pages.yml` builds, validates, and deploys the exact
  `main` revision that passed CI; and
- `.github/workflows/publish.yml` runs the authoritative gate for a tag and
  publishes only after it succeeds.

Two repository-local composite actions own repeated environment setup:

- `.github/actions/setup-node/action.yml` installs pnpm, configures Node.js 24
  with pnpm caching and the npm registry, and runs a frozen-lockfile install;
- `.github/actions/setup-python/action.yml` configures Python 3.14 and `uv`
  with its cache enabled.

The Node action always configures `https://registry.npmjs.org`. This is
harmless for ordinary installs and lets the publishing job authenticate using
`NODE_AUTH_TOKEN` without repeating Node setup. The Python action sets up the
tools only; jobs retain their distinct `uv sync` and test commands.

## Authoritative CI workflow

Add `workflow_call` to `.github/workflows/ci.yml` while preserving direct
`push` events for `main` and all `pull_request` events. The workflow remains a
four-job gate so independent failures stay visible and the jobs remain
parallel:

1. `lint` checks out the revision, uses the Node composite action, and runs
   `pnpm lint`.
2. `python-tests` checks out the revision, uses the Python composite action,
   and syncs and tests both Python packages.
3. `test` checks out the revision, uses both composite actions, syncs the
   Python indexer needed by the cross-implementation test, and runs type
   checks, bundle-size checks, and unit tests.
4. `test-browser` checks out the revision, uses the Node composite action,
   restores the Playwright browser cache, installs Chromium and its operating
   system dependencies, and runs `pnpm test:browser`.

Playwright installation and execution belong only to `test-browser`. The
existing cache-hit distinction remains because restoring browser binaries does
not restore the hosted runner's operating-system packages.

The reusable workflow receives no secrets and performs no publishing or
deployment. A caller succeeds only when all four jobs succeed.

## GitHub Pages workflow

Replace the direct `push` trigger with a `workflow_run` trigger for completed
`CI` runs on `main`. Keep `workflow_dispatch` as an explicit operator
override. The build job runs when either the upstream CI conclusion is
`success` or the workflow was manually dispatched; failed and cancelled CI
runs do not deploy automatically.

For an automatic run, checkout uses
`github.event.workflow_run.head_sha`, ensuring the artifact comes from the
exact revision that passed CI rather than whichever revision is newest when
the Pages runner starts. A manual run uses `github.sha`.

The build job uses the Node composite action, runs `pnpm docs:build`, and then
runs `pnpm --filter showcase validate`. It configures Pages and uploads
`showcase/dist`. It does not install Playwright or run browser tests because
CI already owns those tests for the same revision.

The deploy job remains dependent on the build job and uses
`actions/deploy-pages`. Preserve the current `pages` concurrency behavior so
an in-progress deployment is not cancelled partway through.

Permissions should be job-scoped and least-privilege: the build job needs
`contents: read`; the deploy job needs `pages: write` and `id-token: write`.
The existing omission of a protected `github-pages` environment remains
unchanged because the repository's private-repository plan does not provide
that environment feature.

## npm publishing workflow

Keep the `v*` tag trigger. Add a `checks` job that calls
`./.github/workflows/ci.yml`, which verifies the tag revision with the same
four jobs used by pull requests and `main`.

The `publish` job depends on `checks`. It checks out the tag, uses the Node
composite action, and runs only
`pnpm publish -r --access public --no-git-checks --provenance`. It receives
`NPM_TOKEN` as `NODE_AUTH_TOKEN` for registry authentication and retains
`contents: read` plus `id-token: write` for npm provenance.

No verification commands or Playwright setup are copied into the publishing
job. Browser tests still gate every release through the reusable CI workflow.

## Runtime versions and documentation

Use Node.js 24 in the Node composite action and change the root
`package.json` engine requirement to `>=24`. Update the README and installation
guide to state Node.js 24 or newer. Historical implementation plans and design
records keep the versions they documented at the time; they are not current
installation guidance.

Use Python 3.14 in the Python composite action. Do not change either Python
package's `requires-python = ">=3.10"`: running the latest stable interpreter
in CI verifies forward compatibility and does not by itself justify dropping
older supported interpreters.

## Failure and security behavior

- A failed CI job blocks automatic Pages deployment and npm publishing.
- A cancelled upstream CI run does not start an automatic Pages build.
- A manually dispatched Pages workflow is an intentional operator override
  and still performs a fresh static build and validation.
- Pages checks out only the trusted `main` run's recorded commit. The
  `workflow_run` trigger is not used for pull-request code, avoiding execution
  of untrusted code with the trigger's elevated workflow context.
- npm credentials exist only in the final publishing job after all reusable
  checks pass. The reusable CI jobs receive no npm secret.

## Verification

Before publication, verify:

- workflow YAML passes `actionlint`; composite-action metadata passes YAML
  validation, matches GitHub's metadata structure, and is exercised on a
  hosted runner because `actionlint` does not lint action definition files;
- the active workflow files contain Node.js 24 and Python 3.14 only through
  the composite actions;
- Playwright setup and execution occur only in CI's `test-browser` job;
- `pnpm lint`, `pnpm typecheck`, `pnpm size`, `pnpm test`, and
  `pnpm test:browser` pass locally;
- `pnpm docs:build` followed by `pnpm --filter showcase validate` produces a
  valid Pages artifact; and
- a GitHub pull request proves the reusable workflow and composite actions in
  the hosted runner environment before merge.

After merge, confirm that the successful `main` CI run triggers one Pages
deployment for the same commit. npm publication remains exercised only by an
intentional release tag.

## Architecture decision record impact

No ADR change is required. This design consolidates repository automation and
updates toolchain versions; it does not change the product's runtime
architecture, deployment model, data model, security model, public index
format, or accepted compatibility policy. GitHub Pages continues to publish
the same static showcase artifact described by the existing documentation.

## Non-goals

- Changing search, indexing, ranking, or showcase behavior.
- Changing the Python packages' minimum supported interpreter.
- Replacing GitHub Pages, pnpm, Playwright, or `uv`.
- Publishing Python packages.
- Adding a release tag or testing npm credentials as part of this change.

## Implementation plan

The approved design is mapped to executable tasks in the
[GitHub Actions consolidation implementation plan](../plans/2026-07-13-github-actions-consolidation.md).
