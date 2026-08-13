# Compatibility

This reference distinguishes package-version promises from index-format compatibility and records the `1.0.0` API boundary.

## Package semver

`@ktjn/searchable` is published to GitHub Packages. Within a published major version, breaking changes to exported functions, classes, types, and documented option/result shapes require a new major version. Additive changes may ship in a minor release and fixes in a patch release.

The index generator, `searchable-indexer` (`python/searchable-indexer`), is a Python project versioned and released independently of the npm package above; see its own project for its compatibility posture.

The planned public package API is the export surface in the package's root entry point. `@ktjn/searchable-fixtures` is internal test tooling and is not covered.

## Index format compatibility

The over-HTTP index has an independent integer `Manifest.version`, currently `1`. `@ktjn/searchable` validates it before search and throws `InvalidManifestError` for unsupported versions. A package upgrade does not inherently require an index rebuild; a format-version change does.

| Client package | Supported manifest version |
|---|---|
| `1.0.x`, `1.1.x` | `1` |

Content hashes and `buildId` identify a build, not a compatibility level. The producer should validate output against `spec/schema/` and the reference examples in `spec/examples/`. See ADR-0004 through [Architecture decisions](../project/architecture-decisions.md).

`searchable-client` (Python) is a second consumer of this contract, alongside
`@ktjn/searchable` (TypeScript).

## Language codes

The analysis registry accepts the exact base codes `en`, `de`, `sv`, `nl`, `nb`, `nn`, `no`, `zh`, `ja`, `th`, `km`, and `lo`. Regional BCP 47 tags are not normalized yet. For Norwegian, prefer `nb` or `nn`; `no` is retained as an explicit compatibility tag and is never returned by automatic detection.
