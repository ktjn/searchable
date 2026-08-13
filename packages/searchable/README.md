# `@ktjn/searchable`

Browser runtime for Searchable. Fetches a static index manifest and its content-addressed shards over HTTP, evaluates queries locally, and returns ranked hits.

```ts
import { SearchClient } from "@ktjn/searchable";

const search = new SearchClient("/search/manifest.json");
const result = await search.search("getting started");
```

See [docs/getting-started/first-search.md](../../docs/getting-started/first-search.md) for a complete walkthrough.
