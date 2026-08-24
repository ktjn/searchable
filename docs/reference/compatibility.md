# Compatibility

`@ktjn/searchable` 2.0 is published to GitHub Packages. Within a published major version, breaking changes to exported functions, classes, types, and documented option/result shapes require a new major version. Additive changes may ship in a minor release and fixes in a patch release.

The Python index builder and client ship together in `searchable`. The npm and
Python packages are currently released in lockstep, while the manifest's
integer version remains an independent compatibility boundary.

## Index format compatibility

The over-HTTP index has an independent integer `Manifest.version`, currently
`2`. Both clients validate it before search and raise `InvalidManifestError`
for unsupported versions. Searchable 1.x indexes with manifest version `1`
are incompatible with 2.0 clients; rebuild them with `searchable build`.

| Client package | Supported manifest version |
|---|---|
| `2.0.x` | `2` |

Content hashes and `buildId` identify a build, not a compatibility level. The producer should validate output against `spec/schema/` and the reference examples in `spec/examples/`.

## Language codes

The analysis registry accepts the exact base codes `en`, `de`, `sv`, `nl`, `nb`, `nn`, `no`, `zh`, `ja`, `th`, `km`, and `lo`. Regional BCP 47 tags are not normalized yet. For Norwegian, prefer `nb` or `nn`; `no` is retained as an explicit compatibility tag and is never returned by automatic detection.
