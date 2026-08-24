# ADR-0004: Semver for the public API; a manifest `version` integer for the index format, checked independently

## Status

Accepted (implemented in
`packages/searchable/src/validate-manifest.ts` and
`python/searchable/src/searchable/client/validate_manifest.py`).

**2.0 amendment:** the packages were consolidated into `@ktjn/searchable` and
`searchable`; the latter contains both the sole index builder and the Python
client. The index-format-versus-package-API split remains unchanged.

## Context

Two different things can break compatibility independently: the published
TypeScript/Python API surfaces (function signatures and option shapes), and
the on-disk/over-HTTP manifest and shard format they read and write. A
deployment can upgrade one without the other (rebuild with a new builder
against an old client still deployed, or vice versa),
so they need independent version numbers and independent compatibility
rules, not one combined "package version" meaning both at once.

## Decision

- **API compatibility**: ordinary semver on the published packages,
  per [project/governance.md](../project/governance.md)'s
  Compatibility Policy — a breaking API change requires a major bump,
  documentation, and migration notes.
- **Index format compatibility**: a separate integer,
  `Manifest.version` (currently `2`), checked independently of package semver
  by both clients — a manifest with an unrecognized `version` is
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
- The current supported package and manifest combinations are listed in
  [Compatibility](../reference/compatibility.md).
