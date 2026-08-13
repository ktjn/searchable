# Compatibility

`@ktjn/searchable` 2.0 is published to GitHub Packages. Within a published major version, breaking changes to exported functions, classes, types, and documented option/result shapes require a new major version. Additive changes may ship in a minor release and fixes in a patch release.

The index generator, `searchable-indexer` (`python/searchable-indexer`), and the Python client, `searchable` (`python/searchable-client`), are versioned and released independently of the npm package.

## Index format compatibility

The over-HTTP index has an independent integer `Manifest.version`, currently `2` (introduced in Searchable 2.0). `@ktjn/searchable` validates it before search and throws `InvalidManifestError` for unsupported versions. Indexes produced by Searchable 1.x with `Manifest.version: 1` are not compatible with 2.0 clients — re-index your content with `searchable-indexer` 2.0.

| Client package | Supported manifest version |
|---|---|
| `2.0.x` | `2` |

Content hashes and `buildId` identify a build, not a compatibility level. The producer should validate output against `spec/schema/` and the reference examples in `spec/examples/`.

## Language codes

The analysis registry accepts the exact base codes `en`, `de`, `sv`, `nl`, `nb`, `nn`, `no`, `zh`, `ja`, `th`, `km`, and `lo`. Regional BCP 47 tags are not normalized yet. For Norwegian, prefer `nb` or `nn`; `no` is retained as an explicit compatibility tag and is never returned by automatic detection.
