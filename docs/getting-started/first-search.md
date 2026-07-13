# First search

This page provides the smallest copyable browser path from a deployed index manifest to rendered search results using only implemented exports.

Build an index as described in [Indexing content](../guides/indexing.md), publish the generated directory at `/search-index/`, and copy `@ktjn/searchable-client`'s built worker to `/assets/worker.js`. Then create one client:

```ts
import { SearchClient } from "@ktjn/searchable-client";

const search = new SearchClient({
  indexUrl: "/search-index/manifest.json",
  worker: true,
  workerUrl: new URL("/assets/worker.js", location.href),
});

const result = await search.search("getting started");
for (const hit of result.hits) {
  console.log(hit.fields.title, hit.url);
}
```

`SearchClient` resolves shard paths relative to the manifest URL. Worker execution is enabled only when both `worker: true` and `workerUrl` are supplied; otherwise the same API runs on the calling thread. Call `search.dispose()` when the client is no longer needed.

Add query features through `SearchOptions`, covered in the [Client API reference](../reference/client-api.md).
