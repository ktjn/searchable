# `@ktjn/searchable`

Browser search runtime. Fetches a static JSON index manifest and its content-addressed shards over HTTP, evaluates BM25F lexical queries locally, and returns ranked hits — no query-time server, no per-query cost.

## Features

- BM25F lexical ranking with field, document, and term boosts
- Prefix queries, quoted phrase matching, and fuzzy/typo-tolerant search
- Terms, range, and hierarchical facets with contextual counts
- Query-time synonym expansion and editorial term-to-page pinning
- Multi-language analysis (English, German, Swedish, Dutch, Norwegian, CJK, Thai, Khmer, Lao)
- Result highlighting, cancellation, and lifecycle events
- JSON-only index format — no binary codecs

## Quick start

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

## Documentation

See [docs/getting-started/first-search.md](../../docs/getting-started/first-search.md) for a complete walkthrough, and the [full documentation](../../docs/) for guides and API reference.
