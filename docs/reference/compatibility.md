# Compatibility

This reference distinguishes package-version promises from index-format compatibility and records the current `1.0.0` public API boundary.

## Package semver

`@ktjn/searchable-client`, `@ktjn/searchable-indexer`, `@ktjn/searchable-format`, and `@ktjn/searchable-analysis` are published in lockstep at `1.0.0`. Within the current major version, breaking changes to exported functions, classes, types, and documented option/result shapes require a new major version. Additive changes may ship in a minor release and fixes in a patch release.

The current public package API is the export surface in each package's root entry point. `@ktjn/searchable-fixtures` is internal test tooling and is not covered. Binary storage and vector/hybrid functionality are implemented but identified as experimental in the `1.0.0` changelog, so they may evolve in a minor release with explicit notes.

## Index format compatibility

The over-HTTP index has an independent integer `Manifest.version`, currently `1`. `@ktjn/searchable-client` validates it before search and throws `InvalidManifestError` for unsupported versions. A package upgrade does not inherently require an index rebuild; a format-version change does.

| Client package | Supported manifest version |
|---|---|
| `1.0.x` | `1` |

Content hashes and `buildId` identify a build, not a compatibility level. Producers should validate output against `spec/schema/` and the cross-implementation examples. See ADR-0004 through [Architecture decisions](../project/architecture-decisions.md).
