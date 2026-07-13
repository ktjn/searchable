# Production-core simplification design

## Goal

Make the repository materially smaller and easier to understand by deleting
completed investigation code, consolidating genuine duplication, reducing
unnecessary exports, and simplifying local implementation code. The cleanup
must preserve runtime behavior and index-format compatibility, but it does not
need to preserve every published TypeScript name because the packages have no
users yet. Any actual root-package export removal must still follow the
repository's documented semver policy; removing an unnecessary `export`
modifier from a non-barrel symbol is not a package API change.

The change also makes the live showcase easier to discover and limits every
feature-gallery search to four displayed results.

## Design principles

- Prefer deletion over relocation.
- Extract code only when two maintained runtime paths genuinely share it.
- Do not split a cohesive file merely to make it shorter.
- Do not add configuration for a fixed showcase requirement.
- Keep independent TypeScript and Python implementations separate; they are
  separately installable ports whose conformance is intentional.
- Preserve behavior with tests before simplifying implementation details.
- Require a net reduction in code and exported concepts. Rearrangement alone
  is not a successful outcome.

## Scope

### Retire completed investigation code

Delete the two binary-format investigation programs:

- `packages/indexer/bench/binary-vs-json-postings.mjs`
- `packages/indexer/bench/binary-lazy-decode.mjs`

The investigations have concluded, the resulting binary formats are shipped,
and the conclusions already live in the
[archived binary-format investigation](../../archive/investigations/binary-vs-json-index.md).
Remove their package scripts and replace production-code references to the
programs with references to those archived conclusions where historical
context still helps.

Keep `packages/indexer/bench/json-tier-scaling.mjs`. It exercises the current
indexer and remains useful as a scale-regression benchmark rather than a
discarded format prototype.

### Consolidate genuine shared logic

The client and indexer contain identical SymSpell deletion generation. Both
already depend on `@csf/analysis`, so move the pure algorithm there and cover
it with focused tests. The client and indexer will import the shared function;
neither gains a dependency on the other.

Do not create shared benchmark infrastructure after deleting the completed
binary experiments. Do not merge TypeScript and Python code paths.

### Reduce exports and local complexity

Remove export modifiers and barrel exports that are not part of a necessary
package surface. Initial confirmed candidates include:

- `PhraseTerm` in the client query parser;
- `priceBucketFor` in the showcase corpus generator; and
- `DEFAULT_MAX_TERM_SHARD_GZIP_BYTES` in the TypeScript index writer.

Continue the audit during implementation. A symbol may be removed or made
private only after repository-wide reference checks and compilation confirm it
is not consumed. If a root-package barrel export is removed, update package
versioning and the [compatibility reference](../../reference/compatibility.md)
as required by [ADR-0004](../../adr/0004-compatibility-policy.md). Behavior and
useful supported capabilities remain the primary constraints.

Simplify repeated guards, collection construction, and option defaulting only
when the resulting code is shorter and at least as clear. Avoid speculative
abstractions, broad algorithm rewrites, and file splitting with no net
reduction.

### Showcase discovery and result limit

`README.md` is also the source for the hosted documentation homepage. Move the
live feature-gallery link into the opening introduction as a prominent next
action and remove the later standalone Showcase section, leaving one clear
homepage link instead of two competing placements. The documentation shell's
existing header link remains available on every page.

The shared gallery widget will request at most four results for every feature
demo, including both the six quick examples and the full product, synonym, and
internationalization pages. Apply the limit in the search request rather than
rendering a larger result and hiding items. Use one fixed internal constant;
do not add a data attribute or public configuration option for this showcase-
specific rule. The baseline request used to label fuzzy or synonym-only hits
must use the same limit.

## Testing strategy

Add or adjust tests before changing behavior-bearing code:

- focused `@csf/analysis` tests define Unicode-aware deletion generation at
  edit distances one and two;
- existing client and indexer fuzzy-search tests continue to prove integration
  with the shared helper;
- showcase browser tests assert that result lists never exceed four items and
  that the homepage exposes the live feature-gallery link;
- package tests continue to cover unchanged search and index behavior; and
- static-site validation continues to verify generated links and publishing
  artifacts.

Final verification must run:

- package and showcase type checks;
- unit tests;
- lint;
- all package builds;
- client bundle-size checks;
- the complete `docs:check` publishing gate; and
- browser tests included by that gate.

The four known Windows-only baseline failures involving CRLF stemmer fixtures
and slash-sensitive package-export assertions are not caused by this work. Any
new failure must be investigated and resolved before completion.

## Success criteria

- The two obsolete binary investigation programs and their commands are gone.
- The retained benchmark still runs through the root `bench` command.
- SymSpell deletion generation has one TypeScript implementation.
- Confirmed implementation-only symbols are no longer exported.
- The homepage contains one prominent live-gallery link.
- No feature-gallery result list renders more than four results.
- Runtime search behavior and index-format compatibility remain intact.
- Publishing validation succeeds.
- Tracked code lines and exported concepts decrease relative to the merged
  baseline.

## Non-goals

- Redesigning search, ranking, indexing, or the index format.
- Preserving unused TypeScript API names for hypothetical consumers.
- Combining the TypeScript and Python distributions.
- Replacing the framework-free showcase with a UI framework.
- Splitting large files solely to satisfy a line-count target.
- Removing distinct examples or tests that demonstrate supported behavior.
