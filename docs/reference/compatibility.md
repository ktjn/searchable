# Compatibility

This reference distinguishes the planned package-version promises from index-format compatibility and records the prepared `1.0.0` API boundary.

## Package semver

`@ktjn/searchable-client`, `@ktjn/searchable-indexer`, `@ktjn/searchable-format`, and `@ktjn/searchable-analysis` are not yet published. Their manifests are prepared in lockstep at `1.0.0`, and the semver guarantees below begin with their coordinated first npm release. Within a published major version, breaking changes to exported functions, classes, types, and documented option/result shapes require a new major version. Additive changes may ship in a minor release and fixes in a patch release.

The planned public package API is the export surface in each package's root entry point. `@ktjn/searchable-fixtures` is internal test tooling and is not covered. Binary storage and vector/hybrid functionality are implemented but identified as experimental in the prepared `1.0.0` changelog, so they may evolve in a minor release with explicit notes after publication.

## Index format compatibility

The over-HTTP index has an independent integer `Manifest.version`, currently `1`. `@ktjn/searchable-client` validates it before search and throws `InvalidManifestError` for unsupported versions. A package upgrade does not inherently require an index rebuild; a format-version change does.

| Client package | Supported manifest version |
|---|---|
| `1.0.x` | `1` |

Content hashes and `buildId` identify a build, not a compatibility level. Producers should validate output against `spec/schema/` and the cross-implementation examples. See ADR-0004 through [Architecture decisions](../project/architecture-decisions.md).

## Language codes

The analysis registry accepts the exact base codes `en`, `de`, `sv`, `nl`, `nb`, `nn`, `no`, `zh`, `ja`, `th`, `km`, and `lo`. Regional BCP 47 tags are not normalized yet. For Norwegian, prefer `nb` or `nn`; `no` is retained as an explicit compatibility tag and is never returned by automatic detection.
