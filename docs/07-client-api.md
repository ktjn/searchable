# Client API

## Design goals

- Small, promise-based, framework-agnostic core; official thin wrappers
  for React/Vue/Svelte are separate optional packages, not baked into
  core.
- Works identically whether or not a Web Worker is used underneath
  (see [08-modern-features.md](08-modern-features.md#web-worker-execution)).
- Every network-triggering call is cancellable (`AbortSignal`), since
  instant-search fires a request per keystroke and stale requests must
  not race the latest one.

## Initialization

```ts
import { SearchClient } from "@csf/client";

const client = new SearchClient({
  indexUrl: "https://cdn.example.com/search-index/manifest.json",
  worker: true,               // default true; false = main-thread execution
  cache: "default",           // reuses browser HTTP cache; also keeps an in-memory LRU
  prefetchFacets: ["category", "brand"],
});

await client.ready(); // resolves once the manifest is fetched/parsed
```

## Searching

```ts
const result = await client.search("wireless keyboard", {
  language: "en",              // omit to auto-detect
  filters: { category: "electronics", price: { gte: 20, lte: 100 } },
  facets: ["category", "brand", "price"],
  boosts: { fields: { title: 4 }, terms: { wireless: 2 } },
  fuzzy: true,
  synonyms: true,
  page: { size: 10, offset: 0 },
  sort: "relevance",            // or { field: "publishedAt", order: "desc" }
  signal: abortController.signal,
});

result.hits;        // Hit[] — id, url, score, stored fields, highlighted snippet
result.facets;      // requested facet breakdowns with contextual counts
result.totalHits;
result.tookMs;
```

### Warm-up/preload

Borrowed from Pagefind's `preload()` (see
[12-competitive-landscape.md](12-competitive-landscape.md#features-worth-cherry-picking)):
lets an app fetch likely-needed term shards *before* the user has typed
anything, so the first keystroke's result feels instant rather than
paying a cold-fetch cost on the first real query.

```ts
searchInput.addEventListener("focus", () => {
  client.preload();              // warms manifest + configured prefetch facets
});
searchInput.addEventListener("input", (e) => {
  client.preload(e.target.value); // warms the term shard(s) this partial query will need
});
```

`preload()` is fire-and-forget (returns a promise callers may ignore) and
purely a cache-warming hint — it never blocks or is required before
calling `search()`; a search issued before preloading simply pays the
normal fetch cost.

### Streaming/incremental results

For instant-search UX, a callback-based variant avoids waiting for the
slowest sub-step (e.g. fuzzy fallback) to show the fast path:

```ts
client.searchStream("wigdet", { fuzzy: true }, {
  onPartial: (partial) => renderResults(partial), // fires with exact/prefix matches first
  onComplete: (final) => renderResults(final),    // fires again once fuzzy/synonym passes land
  signal: abortController.signal,
});
```

Both `search()` and `searchStream()` share the same underlying query
plan; `search()` is just `searchStream()` awaited to its final event —
callers pick whichever fits their UI.

## Suggestions / autocomplete

```ts
const suggestions = await client.suggest("widg", { limit: 5 });
// → prefix-matched terms/phrases from the corpus, for a typeahead dropdown
```

## Facet-only queries

```ts
const facetValues = await client.facetValues("brand", { filters: {...} });
// for rendering a facet panel without running a full search (e.g. category landing page)
```

## Federated / multi-index search

```ts
const client = new SearchClient({
  indexUrl: [
    "https://cdn.example.com/docs-index/manifest.json",
    "https://cdn.example.com/blog-index/manifest.json",
  ],
});
// results are merged and re-ranked client-side across both manifests
```

Each sub-index keeps its own corpus statistics (avgFieldLength, docCount,
idf) for correct per-index BM25 computation; cross-index merging
normalizes scores (min-max or z-score normalization per source, a
documented, overridable strategy) before interleaving, since raw BM25
scores aren't directly comparable across corpora with different
vocabularies.

## Pinning a manifest

Two supported wiring patterns for the "how does the client know the
*current* manifest hash" problem
([02-index-format.md](02-index-format.md#versioning--cache-strategy)):

1. **Alias file**: build tooling also writes an unhashed
   `manifest.json` that simply points at the current hashed manifest
   filename, served with `Cache-Control: no-cache` (always revalidated,
   cheap because it's tiny) — `indexUrl` in the client config is this
   alias, unchanging across deploys.
2. **Build-time inlining**: the consuming app's build pulls the current
   manifest hash from the indexer's build output (e.g. a small JSON
   sidecar) and inlines the full hashed URL into its own HTML/JS bundle,
   so there's no extra request at all — appropriate when the search UI
   and the indexed content are deployed together in lockstep.

## SSR/SSG compatibility

The client is usable in a server-rendering context for the **query
construction and result-shape types only** (pure functions, no DOM/Worker
dependency); actual index fetch + execution is browser-only by design
(the whole point is client-side execution) — an SSR page can prerender
an empty/placeholder search UI and hydrate the live client on the client,
which is standard practice for this class of widget.

## Error handling & degradation

- Network failure fetching a shard → that shard's terms are treated as
  "no matches" for a `should` clause (soft-fail) but surfaces a
  `result.warnings` entry, or hard-fails a `must` clause with a thrown
  `PartialIndexError` — behavior configurable (`onFetchError: "soft" | "throw"`),
  since a partial static hosting outage shouldn't necessarily null out
  an entire search UI.
- If Web Workers are unavailable (rare, e.g. certain locked-down
  embedded webviews), core transparently falls back to main-thread
  execution rather than failing to initialize.
