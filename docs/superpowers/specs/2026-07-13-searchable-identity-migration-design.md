# 2026-07-13 Searchable identity migration design

## Goal

Rename the entire project from client-search-framework and CSF to Searchable
before it has external users. The migration replaces the repository and Pages
identity, all npm package names, both local Python distributions and import
packages, CLI names, CMS controls, diagnostics, schema identifiers,
documentation, examples, tests, and internal labels. It deliberately provides
no compatibility aliases for the old identity.

The implementation is one atomic code migration followed by a controlled
external cutover. No npm or Python package is published as part of the rename.

## Naming contract

Use the following exact names:

| Surface | New name |
| --- | --- |
| Product and root workspace | `searchable` |
| Public npm client | `@ktjn/searchable-client` |
| Public npm indexer | `@ktjn/searchable-indexer` |
| Public npm analysis package | `@ktjn/searchable-analysis` |
| Public npm format package | `@ktjn/searchable-format` |
| Private npm fixture package | `@ktjn/searchable-fixtures` |
| TypeScript and Python CLI | `searchable-indexer` |
| Python distributions | `searchable-analysis`, `searchable-indexer` |
| Python import packages | `searchable_analysis`, `searchable_indexer` |
| CMS meta-tag prefix | `searchable-` |
| CMS data-attribute prefix | `data-searchable-` |
| Environment-variable prefix | `SEARCHABLE_` |
| Indexer diagnostic prefix | `[searchable-indexer]` |
| GitHub repository | `ktjn/searchable` |
| GitHub Pages project site | `https://ktjn.github.io/searchable/` |
| Preferred local checkout | `C:\git\searchable` |

All four public npm packages start at `1.0.0`. The private fixture package
remains `0.0.0`. The local Python distributions remain `0.1.0`; they are not
published to PyPI during this migration.

Generic API concepts are not branding and do not change. Keep names such as
`SearchClient`, `SearchResult`, `buildIndex`, `SourceDocument`, and the
`packages/client` directory. Renaming these would add churn without removing
the former identity.

## Atomic code migration

The code migration lands as one pull request so the repository never exposes a
mixed package or protocol identity on `main`. Work may be committed in smaller
reviewable units, but the branch is not merged until every surface and test has
converged on Searchable.

### npm workspace and publication

Rename the root workspace and all five workspace package names. Update every
workspace dependency, import, Vite external, root filter, example, test,
package description, repository URL, homepage, bugs URL, and lockfile entry.
The published package metadata points directly at
`https://github.com/ktjn/searchable` even though that repository URL becomes
live only during the immediate post-merge cutover.

The TypeScript indexer exposes only the `searchable-indexer` binary. Consumer
fixture tests must resolve the new package names and binary and must no longer
resolve an old package or executable name. Package-content dry runs verify that
each public package contains its expected JavaScript, declarations, worker or
service-worker entries, and metadata before any later release tag can publish
it.

The existing release workflow remains the only npm publication path. This
migration does not create a tag, send npm credentials, claim names, or publish
packages. The `@ktjn/searchable-*` names must be rechecked immediately before a
future first release because registry availability can change.

### Python projects and imports

Rename both distribution directories to `python/searchable-analysis` and
`python/searchable-indexer`. Rename source-package directories to
`searchable_analysis` and `searchable_indexer`, then update every internal and
test import. The indexer distribution depends on local
`searchable-analysis`, exposes the `searchable-indexer` console script, and
uses the renamed editable `uv` source.

Cross-implementation tests use the new project path, CLI, and module imports.
Wheel-content checks prove that only the new import-package directories are
packaged. No forwarding modules, old console-script entry, or dual project
names remain. PyPI publication is explicitly out of scope.

### CMS controls and diagnostics

Replace the HTML-facing contract in both indexers and every fixture, example,
schema description, guide, and test:

- `data-searchable-body` selects the explicit content body;
- `data-searchable-ignore` excludes a descendant;
- `searchable-noindex` excludes a page;
- `searchable-boost` controls document boost;
- `searchable-facet-<field>` declares a terms or hierarchy facet;
- `searchable-facet-range-<field>` declares a numeric range facet; and
- `searchable-pin`, `searchable-pin-mode`, `searchable-pin-priority`, and
  `searchable-pin-exclusive` declare editorial pins.

The TypeScript and Python extractors accept only these names. Do not retain
dual selectors or fallback parsing for the former controls. Rename indexer
usage text, warnings, temporary-file prefixes, test descriptions, comments,
and the opt-in real-Transformers environment variable to the Searchable
identity as well.

### Format identifiers

Change every JSON Schema `$id` to the corresponding canonical raw-repository
URL under:

```text
https://raw.githubusercontent.com/ktjn/searchable/main/spec/schema/
```

Update schema titles and descriptions that contain the former product or CMS
identity. Keep `Manifest.version` at `1`: the serialized manifest and shard
shapes, validation rules, hashes, and binary encodings do not change. A schema
document identifier and producer label change is not a wire-format change.

### Documentation, showcase, and history

Brand the README, documentation shell, feature gallery, page titles, generated
search corpus, installation commands, API references, examples, source links,
license notice, and repository metadata as Searchable. All generated GitHub
links target `ktjn/searchable`; all hosted links use the `/searchable/` project
base.

Update maintained historical documents, archived investigations, prior plans,
and prior specifications so copied commands and examples do not teach obsolete
package, CLI, import, or CMS names. Preserve their historical conclusions and
dates; only identity-dependent wording and paths change.

The migration design and its implementation plan are the only tracked files
allowed to mention former identifiers, because they document the mapping and
cutover. Git history is not rewritten.

## Test-first migration strategy

Change contract tests before the corresponding implementation:

1. Consumer-fixture tests require `@ktjn/searchable-*` resolution and the
   `searchable-indexer` binary.
2. TypeScript and Python extraction tests use only `searchable-*` and
   `data-searchable-*` controls and fail until both extractors change.
3. Python public-API and CLI tests import and execute only the renamed projects.
4. Cross-implementation tests use the renamed Python indexer and prove the two
   producers remain byte-compatible.
5. Showcase and documentation tests require Searchable branding and new GitHub
   and Pages links.
6. A repository identity policy test rejects former identifiers everywhere
   except this migration spec and its implementation plan.

The identity policy test scans tracked source rather than build output,
dependency directories, `.git`, or runtime caches. Matching is
case-insensitive and covers the product name, `@csf`, `csf-`, `csf_`, and
upper-case `CSF` families. It provides an explicit allowlist containing only
the two migration documents; it does not grow ad hoc exemptions.

## Verification gates

Before the pull request is merged, run:

- frozen pnpm installation and lockfile validation;
- lint, package builds, type checks, bundle-size checks, and all unit tests;
- all Playwright browser tests and the complete `docs:check` publishing gate;
- TypeScript package-content dry runs for all four public packages;
- both Python suites on Python 3.14;
- Python wheel builds and wheel-content inspection;
- JSON Schema validation and TypeScript/Python byte-conformance tests;
- the repository identity policy test; and
- hosted GitHub CI using the renamed local composite actions and package graph.

The branch must contain no generated site output or built packages. The final
diff must contain only identity migration code, tests, metadata, documentation,
and migration planning records.

## External cutover

Perform external changes only after the rename pull request is green and
merged:

1. Rename `ktjn/client-search-framework` to `ktjn/searchable` through GitHub.
2. Verify the repository redirect and change local `origin` directly to
   `https://github.com/ktjn/searchable.git`.
3. Update the GitHub About description and homepage to the new Searchable
   identity and Pages URL.
4. Manually dispatch the Pages workflow in `ktjn/searchable`. A repository
   rename does not redirect the former GitHub Pages project-site URL, and the
   rename itself does not provide the new deployment artifact.
5. Wait for CI and Pages completion, then verify the new homepage, gallery,
   local links, assets, fragments, and source links at
   `https://ktjn.github.io/searchable/`.
6. Confirm the old repository URL redirects, while treating the old Pages URL
   as intentionally retired.
7. Rename the local checkout to `C:\git\searchable` only after the remote and
   hosted site are healthy.

The existing nested documentation worktree contains an untracked
`.superpowers/` directory and therefore must not be discarded for cosmetic
cleanup. Move it with the repository directory and use `git worktree repair`
from the new root so both worktree registrations point at their new absolute
paths. If Windows prevents the parent-directory move, keep the old local path
and report that single incomplete cosmetic step; do not delete or overwrite
the nested worktree.

GitHub redirects repository web and Git traffic after a rename, but not project
site URLs. The external procedure follows GitHub's
[repository rename guidance](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository).

## Failure handling

- If contract tests reveal a former identifier with ambiguous meaning, classify
  it as branding or a generic search concept before changing it; do not blindly
  rename generic APIs.
- If an npm name is no longer available, stop before merge and choose a new
  package family rather than partially publishing or adding aliases.
- If the GitHub repository rename fails, leave the remote, Pages site, and local
  directory unchanged and report the blocking permission or collision.
- If the new Pages deployment fails, keep the renamed repository and remote
  usable, repair the workflow or repository setting, and do not rename the
  local directory until the new site is healthy.
- If local directory or worktree repair fails, preserve both worktrees in place
  and report the remaining path mismatch. Never delete untracked worktree data
  to force the rename.

## Compatibility and ADR impact

No ADR decision changes. The migration intentionally replaces package and CMS
API identity before adoption, while preserving the architecture, static
deployment model, ranking behavior, index shapes, and independent manifest
format version described by the existing ADRs. The new npm package identities
start at `1.0.0`; the former packages receive no compatibility release.

ADR-0004 remains accurate: future changes to the new public packages follow
semver, and wire-format compatibility remains governed independently by
`Manifest.version`.

## Success criteria

- Every naming-contract target is implemented exactly.
- Current and historical product documentation uses Searchable commands and
  links.
- Only the migration spec and plan mention former identifiers in tracked files.
- The new npm packages build and pack at `1.0.0` without being published.
- Python imports, CLI execution, tests, and wheels use only Searchable names.
- Both indexers accept only the new CMS controls and remain conformant.
- All local and hosted verification gates pass.
- The live repository is `ktjn/searchable` and its `origin` is updated.
- `https://ktjn.github.io/searchable/` builds and works end to end.
- The local root is `C:\git\searchable`, or the unchanged old path is reported
  without data loss if the best-effort move is blocked.

## Non-goals

- Renaming generic search APIs solely because they contain the word `Search`.
- Maintaining aliases, redirects for the old Pages site, or dual CMS parsing.
- Publishing npm or Python packages.
- Changing runtime search behavior, ranking, index schema shapes, or format
  version.
- Rewriting Git history or release dates.

## Implementation plan

The approved migration is mapped to executable tasks in the
[Searchable identity migration implementation plan](../plans/2026-07-13-searchable-identity-migration.md).
