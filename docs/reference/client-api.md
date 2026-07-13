# Client API

This reference lists the implemented `@ktjn/searchable-client` surface and the exact option names used by the current `1.0.0` package.

## SearchClient

```ts
const client = new SearchClient(options);
const result = await client.search(query, searchOptions);
const final = await client.searchStream(query, streamOptions);
const facet = await client.facetValues(field, facetOptions);
const unsubscribe = client.on("result", ({ result }) => {});
client.dispose();
```

`SearchClientOptions` contains `indexUrl`, `worker`, `workerUrl`, `allowCrossOriginShards`, `strict`, `embedQuery`, and `validateVectorProvider`. `indexUrl` is required. Worker mode requires a `workerUrl`; otherwise calls execute directly.

## Search options and results

`SearchOptions` contains:

- `language`, `limit`, and `boosts.fields` / `boosts.terms`
- `filters` and `facets`
- `synonyms` / `synonymWeight`
- `fuzzy` / `fuzzyWeight`
- `highlight` and `signal`
- `mode: "lexical" | "vector" | "hybrid"` and `vectorWeight`

`SearchResult` contains `hits`, `totalHits`, and `language`, plus requested `facets` and optional `didYouMean`. Every `Hit` has `id`, `score`, `url`, and stored `fields`; it may include `pinned` and `highlights`.

## Streaming/incremental results

`SearchStreamOptions` adds `onPartial`. A partial literal/prefix result is emitted only when synonym or fuzzy expansion requires a later final pass. `AbortSignal` cancels waiting for a caller without invalidating a shared cached fetch.

## Facet-only queries

`facetValues(field, options)` accepts `filters` and `signal` through `FacetValuesOptions` and returns a `FacetResult`.

## Events and lifecycle

`on("query", listener)` and `on("result", listener)` return unsubscribe functions. Events are local observation hooks; the library sends no analytics. `dispose()` is idempotent, terminates the worker, rejects pending work, and prevents future use.

## Other exports

The package exports highlighting types, manifest validation (`validateManifest`, `InvalidManifestError`), offline caching (`registerOfflineCaching`), RTL detection, vector helpers and errors, and the optional Transformers query adapter. The complete type declarations shipped with the package are the normative API. Designs for warm-up, suggestions, federation, and broader diagnostics are archived and linked from the [roadmap](../project/roadmap.md).
