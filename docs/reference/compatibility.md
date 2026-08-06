# Compatibility

This reference distinguishes package-version promises from index-format compatibility and records the `1.0.0` API boundary.

## Package semver

`@ktjn/searchable-client`, `@ktjn/searchable-format`, and `@ktjn/searchable-analysis` are published to GitHub Packages in lockstep at `1.0.0` and later tag releases. Within a published major version, breaking changes to exported functions, classes, types, and documented option/result shapes require a new major version. Additive changes may ship in a minor release and fixes in a patch release.

The index generator, `searchable-indexer` (`python/searchable-indexer`), is a Python project versioned and released independently of the npm packages above; see its own project for its compatibility posture.

The planned public package API is the export surface in each package's root entry point. `@ktjn/searchable-fixtures` is internal test tooling and is not covered. Binary storage and vector/hybrid functionality are implemented but identified as experimental in the prepared `1.0.0` changelog, so they may evolve in a minor release with explicit notes after publication.

## Index format compatibility

The over-HTTP index has an independent integer `Manifest.version`, currently `1`. `@ktjn/searchable-client` validates it before search and throws `InvalidManifestError` for unsupported versions. A package upgrade does not inherently require an index rebuild; a format-version change does.

| Client package | Supported manifest version |
|---|---|
| `1.0.x`, `1.1.x` | `1` |

Content hashes and `buildId` identify a build, not a compatibility level. The producer should validate output against `spec/schema/` and the reference examples in `spec/examples/`. See ADR-0004 through [Architecture decisions](../project/architecture-decisions.md).

`searchable-client` (Python) is a second consumer of this contract, alongside
`@ktjn/searchable-client` (TypeScript). The structured binary v2 tests exercise
the real Python indexer output in both clients, while the browser Worker and
Service Worker suites verify the TypeScript path over HTTP and offline cache.

## Worker protocol versions

`@ktjn/searchable-client`'s `index.js` (the `SearchClient` main thread) and its
`worker.js` script speak a versioned postMessage protocol. The main thread
sends the protocol version in `init`; the Worker echoes it back in its `init`
result, and `SearchClient` treats a *known foreign* version as a hard
incompatibility: `ready()` rejects with a clear error rather than leaving a
request hanging.

| Protocol version | Main-thread client | Worker script | Error payloads |
|---|---|---|---|
| 1 (legacy) | — (pre-handshake) | — | `{ message }` |
| 2 (current) | `1.1.3`+ | `1.1.3`+ | `{ error: { code, name, message } }` |

During the transition the current client still accepts a version-1 Worker's
`{ message }` error responses and version-1 `init` results, so a stale cached
Worker next to a freshly deployed bundle settles requests instead of hanging.
The reverse (an old client against a current Worker) is safest handled by
avoiding mixed deploys — deploy `index.js` and `worker.js` from the same
package version. Content-hashed Worker URLs are the recommended pattern so a
new bundle naturally fetches the matching script:

```ts
new SearchClient({
  indexUrl,
  workerUrl: new URL("./worker.<content-hash>.js", import.meta.url),
});
```

## Language codes

The analysis registry accepts the exact base codes `en`, `de`, `sv`, `nl`, `nb`, `nn`, `no`, `zh`, `ja`, `th`, `km`, and `lo`. Regional BCP 47 tags are not normalized yet. For Norwegian, prefer `nb` or `nn`; `no` is retained as an explicit compatibility tag and is never returned by automatic detection.
