# ADR-0004: Semver for the public API; a manifest `version` integer for the index format, checked independently

## Status

Accepted (index-format check implemented since Phase 1,
`packages/client/src/validate-manifest.ts`; the API-semver half takes
effect at the 1.0 tag itself, see [reference/compatibility.md](../reference/compatibility.md)).

## Context

Two different things can break compatibility independently: the
`@csf/client`/`@csf/indexer` public API surface (function signatures,
option shapes), and the on-disk/over-HTTP manifest+shard format they
read and write. A deployment can upgrade one without the other (rebuild
with a new indexer against an old client still deployed, or vice versa)
so they need independent version numbers and independent compatibility
rules, not one combined "package version" meaning both at once.

## Decision

- **API compatibility**: ordinary semver on the published npm packages,
  per [project/governance.md](../project/governance.md)'s
  Compatibility Policy — a breaking API change requires a major bump,
  documentation, and migration notes.
- **Index format compatibility**: a separate integer,
  `Manifest.version` (currently `1`, `packages/format/src/index.ts`),
  checked by `@csf/client`'s `validateManifest()` independently of the
  package's own semver — a manifest with an unrecognized `version` is
  rejected with a named `InvalidManifestError` before any query
  executes, rather than failing opaquely deep inside search logic. The
  supported client-version ↔ index-version pairing is a documented table
  ([Compatibility](../reference/compatibility.md#index-format-compatibility)),
  not an inferred rule.

## Alternatives Considered

- **One version number for both**: rejected — it would force every API
  change to also be an index-format break (or vice versa) even when
  only one actually changed, which is both untrue and would make
  ordinary non-format-affecting API improvements look like forced index
  rebuilds.
- **No explicit format version, infer compatibility from shape**:
  rejected — this is exactly the failure mode
  [project/governance.md](../project/governance.md) calls out
  ("older clients should fail with clear compatibility errors"); an
  inferred/duck-typed check degrades to a confusing error deep inside
  query execution instead of a clear one at load time.

## Consequences

- A format revision that isn't purely additive bumps `Manifest.version`
  and adds a row to the support matrix — old clients then fail loudly
  and immediately for that manifest instead of returning wrong or
  partial results.
- The 1.0 tag is the point where the API-compatibility half of this
  policy starts applying; the current frozen boundary is listed in
  [Compatibility](../reference/compatibility.md).
