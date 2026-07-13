# Public Repository Readiness Design

## Goal

Prepare Searchable for public source visibility without claiming that its npm
or Python packages have been published. A visitor should understand what the
project does, what is implemented, how to evaluate it today, how to contribute,
and what remains before the first package release.

## Launch position

Searchable is a public preview with an implemented and tested `1.0.0` package
surface, but no registry release. The live documentation and feature gallery
are the primary evaluation path. Repository development instructions are
copyable; consumer installation commands remain absent until the corresponding
npm packages exist.

The four public npm package manifests keep version `1.0.0` so their packed
artifacts remain release-ready. Documentation calls this the planned first npm
release rather than a published or stable release. Python packages remain
local interoperability tools and are not presented as PyPI releases.

## Public documentation

The root README will:

- keep the current product description, capability summary, live gallery, and
  documentation links;
- replace the non-working npm quick start with a public-preview section that
  directs evaluation to the gallery and repository development workflow;
- state plainly that no npm or PyPI package has been published yet;
- describe `1.0.0` as the planned first npm release; and
- link the contribution and security policies.

The installation, compatibility, changelog, governance, and other release
wording will use the same distinction. `[Unreleased]` will be the active
changelog section, with the prepared `1.0.0` feature summary nested under it
until a real release tag and registry publication exist.

Each public npm package will gain a short package-local README describing its
role, current unpublished status, intended package name, and repository links.
All four public package manifests will declare Node.js `>=24`, matching the
project's supported toolchain and runtime contract. The private fixtures
package remains internal and receives no public package README.

## Community surface

The repository will add:

- `CONTRIBUTING.md` with setup, focused/full verification, documentation, ADR,
  and pull-request expectations;
- `SECURITY.md` directing reports to GitHub private vulnerability reporting
  and explicitly forbidding public vulnerability issues;
- structured bug-report and feature-request issue forms plus issue-form
  configuration; and
- a pull-request template with scope, verification, compatibility, and
  documentation checks.

No Code of Conduct is added in this pass because the project has not selected
one. The absence is explicit rather than silently copying a policy the
maintainer has not adopted.

## GitHub repository properties

The repository description, homepage, MIT license, Issues, Pages workflow, and
default branch already form a sound public surface and remain unchanged.

Before visibility changes, repository topics will be set to:

- `static-search`
- `full-text-search`
- `browser-search`
- `typescript`
- `python`
- `bm25`
- `offline-first`
- `search-engine`

Wiki will be disabled because versioned repository documentation is canonical.
A `main` ruleset will require the four existing CI checks (`lint`,
`python-tests`, `test`, and `test-browser`), require pull requests, block force
pushes, and block branch deletion. If the current private-repository plan does
not permit that ruleset, creation becomes an explicit post-public checklist
item rather than weakening or faking the protection.

The implementation does not change repository visibility. After the maintainer
makes the repository public, the checklist requires enabling and verifying
secret scanning, push protection, private vulnerability reporting, Dependabot
security updates, and code scanning. Settings unavailable to a private
repository are not treated as completed early.

## Privacy and history boundary

This work does not rewrite Git history. Existing non-noreply commit addresses,
including a Gmail address, will become visible when the repository becomes
public. The maintainer must explicitly accept that exposure or authorize a
separate coordinated history rewrite before changing visibility.

No release tag, GitHub release, npm publication, PyPI publication, credential
creation, or visibility change is part of this work.

## Drift prevention

A public-readiness policy test will verify:

- all required community files and package READMEs exist;
- root and installation documentation say the npm packages are not yet
  published and do not claim they are currently installable from npm;
- compatibility and changelog text do not call `1.0.0` published;
- all four public package manifests declare version `1.0.0`, Node.js `>=24`,
  and the canonical repository; and
- the public launch checklist records every post-visibility security gate.

The test checks durable public contracts, not exact prose or formatting.

## Post-merge planning cleanup

After the public-readiness pull request is merged, a separate cleanup change
will remove the completed internal execution material under
`docs/superpowers/plans/` and `docs/superpowers/specs/`, including this design
and its implementation plan. These files are agent working records rather than
public product documentation; the durable decisions already live in ADRs,
current documentation, tests, and archived project history.

Before deletion, references outside those two directories will be redirected
to durable documentation or removed when they only support an obsolete
allowlist. The cleanup will specifically update the binary conformance test's
design-file comment and simplify the project-identity policy test. It will then
verify that no tracked file links to a removed planning document. The cleanup
does not remove `docs/archive/`, accepted ADRs, the roadmap, or implementation
history.

## Verification

Implementation is complete when:

1. the policy test fails against the pre-change repository and passes after the
   public-readiness files and wording land;
2. Biome, type checking, bundle-size checks, Vitest, Python tests, browser
   tests, documentation build, and showcase validation pass;
3. all README and community-file links resolve;
4. all four public npm packages build and pack with their package-local README,
   license, declarations, JavaScript, and expected entry points;
5. GitHub reports the requested topics and Wiki disabled;
6. the ruleset exists, or the API returns a plan limitation recorded in the
   post-public checklist; and
7. the working tree is clean apart from the separately preserved documentation
   worktree.

## Out of scope

- making the repository public;
- rewriting commit history or changing author identities;
- publishing npm or Python packages;
- creating tags or GitHub releases;
- changing product APIs, index format version, or package names; and
- adding unrelated documentation or implementation features.
