# First search

This page provides the smallest copyable browser path from a deployed index manifest to rendered search results using only implemented exports.

Build an index as described in [Indexing content](../guides/indexing.md) and publish the generated directory at `/search-index/`. Then create one client:

```ts
import { SearchClient } from "@ktjn/searchable";

const search = new SearchClient({
  indexUrl: "/search-index/manifest.json",
});

const result = await search.search("getting started");
for (const hit of result.hits) {
  console.log(hit.fields.title, hit.url);
}
```

Call `search.dispose()` when the client is no longer needed.

Add query features through `SearchOptions`, covered in the [Client API reference](../reference/client-api.md).
