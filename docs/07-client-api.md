# Client API

**Status**: "Implemented today" below is real, tested code
(`packages/client`) — see [09-roadmap.md](09-roadmap.md#status) for
what's built vs. pending. Everything under a "Target API" heading is
design-only: do not treat option/method names there as stable, and
don't use them as the primary usage example — they're what
[REVIEW.md](archive/REVIEW.md)'s "client API docs overpromise" finding
was about, and this doc was restructured specifically to fix that.

## Design goals

- Small, promise-based, framework-agnostic core; official thin wrappers
  for React/Vue/Svelte are separate optional packages, not baked into
  core.
- Works identically whether or not a Web Worker is used underneath
  (see [08-modern-features.md](08-modern-features.md#web-worker-execution)).
- Every network-triggering call is cancellable (`AbortSignal`), since
  instant-search fires a request per keystroke and stale requests must
  not race the latest one — see "Cancellation" under "Implemented
  today" below.

## Implemented today

### Initialization

```ts
import { SearchClient } from "@csf/client";

const client = new SearchClient({
  indexUrl: "https://cdn.example.com/search-index/manifest.json",
  worker: true,               // default true; false = main-thread execution
  workerUrl: new URL("@csf/client/dist/worker.js", import.meta.url),
});

await client.ready(); // resolves once the manifest is fetched/parsed
```

`workerUrl` isn't auto-resolved from `worker: true` alone — every
bundler (Vite, webpack, esbuild, or none at all) has its own
incompatible convention for referencing a sibling worker file from a
library, and guessing one specific convention would silently break
under the others. Point it at wherever your build/CDN actually serves
this package's `dist/worker.js`; omitting it runs on the main thread
regardless of `worker`, the same graceful-degradation behavior as a
missing `Worker` global.

`indexUrl` may be relative — it's resolved against the page's own
location (or the worker's, when running in one) before anything is
fetched.

### Searching

```ts
const result = await client.search("wireless keyboard", {
  language: "en",                              // omit to use the manifest's defaultLanguage
  filters: {
    category: "electronics",                   // terms facet: string | string[] (OR within a field, AND across fields)
    price: { min: 20, max: 100 },               // range facet: {min?, max?} -- shape is determined by the field's own facet type
  },
  facets: ["category", "brand"],               // contextual counts for these facet fields
  boosts: { fields: { title: 4 }, terms: { wireless: 2 } },
  limit: 10,                                   // default 10
});

result.hits;        // Hit[] -- id, url, score, stored fields, pinned?, highlights? (see Highlighting below)
result.facets;      // Record<field, FacetResult> -- only for fields requested via `facets`
result.totalHits;
```

Prefix queries (a trailing `*`, e.g. `"widg*"`) and `"quoted phrase"`
queries (requiring the words to appear adjacent, in order, in the same
field — see [04-query-ranking-boosts.md#phrase--proximity-queries](04-query-ranking-boosts.md#phrase--proximity-queries))
are both written directly in the query string, not a separate option.
`-term` exclusion, OR mode, and `field:term` field-restriction remain
design-only (see that doc's status note). Term-to-page pinning
([16-term-to-page-pinning.md](16-term-to-page-pinning.md)) is
transparent: a matching pin is spliced into `result.hits` automatically
(marked `pinned: true`), no separate call needed.

`page`/`sort` and `result.tookMs` are **not implemented** — see Target
API below. `signal` *is* implemented — see Cancellation below.
`synonyms`, `fuzzy`, and `highlight` *are* implemented — see below. A
range facet's aggregate results (a histogram/bucket breakdown in
`result.facets`) *are* also implemented — either equal-width buckets
over the corpus's observed `[min, max]` (5 per field by default,
configurable at build time via `buildIndex(sources, lang, {
rangeFacetBuckets: { price: 10 } })`), or fixed, author-chosen
brackets via an ascending-boundaries array (`{ rangeFacetBuckets: {
price: [25, 50, 100, 250] } }`, producing `"<25"`/`"25-50"`/.../`"250+"`
buckets independent of the observed data range) — same as range
*filtering* (the `{min, max}` shape above).

### Hierarchical facets

```ts
const result = await client.search("headphones", {
  filters: { category: "electronics>audio" },   // matches this branch AND everything under it
  facets: ["category"],
});

result.facets?.category?.separator;   // ">" -- only present for a hierarchy-type field
result.facets?.category?.values;      // one flat entry per path level: "electronics", "electronics>audio", "electronics>audio>headphones", ...
```

A field built with `buildIndex(sources, lang, { hierarchicalFacets: {
category: { separator?: ">" } } })`
([06-faceted-search.md](06-faceted-search.md#facet-index-structure))
stores every ancestor path as its own addressable entry, so filtering
by `"electronics"` matches every doc under that whole subtree and
filtering by `"electronics>audio"` matches only that branch — an exact
string match against whichever level you pass, same `filters`/`facets`
option shapes as an ordinary terms facet. The only thing to reach for
that's specific to a hierarchical field is `FacetResult.separator`,
which lets a consumer split a returned `value` into its path segments
without hardcoding the delimiter; reconstructing a tree widget from
those flat, separator-delimited entries is left to the consumer.

### Synonyms

```ts
const result = await client.search("sofa", {
  synonyms: true,               // off by default -- opt in per query
  synonymWeight: 0.5,           // default 0.5x -- a literal match still outranks a synonym-only one
});
```

Expands each non-prefix query term through the manifest's synonym
shard for the resolved language, if the index has one
([05-synonyms.md](05-synonyms.md)) — equivalence classes and
directional maps only; multi-word phrase synonyms aren't implemented
yet. A term with no synonym data, or a manifest with no synonym shard
at all, behaves exactly as if `synonyms` were omitted.

### Fuzzy matching & did-you-mean

```ts
const result = await client.search("wigdet", {
  fuzzy: true,                  // off by default -- opt in per query
  fuzzyWeight: 0.5,             // default 0.5x, raised to the power of edit distance
});

result.didYouMean;               // string[] | undefined -- only populated when fuzzy is true and hits is empty
```

Expands each non-prefix query term into typo-tolerant matches from the
manifest's SymSpell deletion-dictionary shard for the resolved
language, if one exists
([04-query-ranking-boosts.md](04-query-ranking-boosts.md#prefix--fuzzy-matching)).
A literal match always outranks a fuzzy-only one. `didYouMean` is a
byproduct of the same dictionary: nearest real terms in the corpus for
a query term that still matched nothing, surfaced only when the query
returned zero hits.

### Highlighting

```ts
const result = await client.search("wireless keyboard", {
  highlight: true,               // off by default
});

result.hits[0].highlights;       // Record<field, { text: string; isMatch: boolean }[]> -- one array per stored field
```

Splits each stored field's text (today: `title`, `excerpt`) into
match/non-match spans for the literal query terms actually typed
(prefix-aware for `term*`), so a consumer renders its own `<mark>` (or
any other) wrapper around `isMatch` spans without a
`dangerouslySetInnerHTML` step. Scoped to literal terms only — a hit
that only matched via synonym expansion or fuzzy correction doesn't get
that expanded/corrected term highlighted (see
[08-modern-features.md](08-modern-features.md#highlighting--snippets)
for why).

### Facet-only queries

```ts
const result = await client.facetValues("brand", {
  filters: { category: "electronics" },   // narrows counts by every OTHER active filter field
});

result.values;   // FacetResultValue[] -- { value, count, selected }[], same shape as SearchResult.facets[field].values
```

A filter-only browsing call with no free-text query — e.g. rendering a
facet panel on a category landing page before a visitor has typed
anything. Counts are contextual against every *other* active filter,
same convention as `search()`'s `facets` option: a field's own active
filter is excluded from its own count computation, so switching between
its own values shows real per-value counts. A range-type field returns
aggregate bucket values, and a hierarchy-type field returns `separator`
alongside its flat per-level `values`, the same way `search()`'s
`facets` option does for both (see above); an unknown field returns an
empty `values` array.

### Observability hooks

```ts
const unsubscribe = client.on("query", ({ query, options }) => {
  analytics.track("search_query", { query });
});
client.on("result", ({ query, options, result }) => {
  if (result.totalHits === 0) analytics.track("zero_result_query", { query });
});

unsubscribe(); // stop listening -- on() returns this instead of requiring a separate off() call
```

`"query"` fires synchronously the moment `search()` is called, before
any fetch/worker round trip; `"result"` fires once it resolves. Fires
identically whether the query ran on the main thread or inside a
Worker. Scoped to `search()` only — `facetValues()` has no query text
for a `"query"` event to carry
([08-modern-features.md](08-modern-features.md#observability-hooks)). A
listener that throws doesn't break the `search()` call it's observing.

### Cancellation

```ts
const controller = new AbortController();
searchInput.addEventListener("input", async (e) => {
  controller.abort();               // supersede any still-in-flight previous query
  const result = await client.search(e.target.value, { signal: controller.signal });
  renderResults(result);            // never runs for a query that got superseded
});
```

`search()` and `facetValues()` both accept `options.signal`. An
already-aborted signal rejects immediately, before any fetch/worker
round trip; a signal that aborts mid-flight rejects the call with a
`DOMException` named `"AbortError"` as soon as it fires. This does
**not** cancel the underlying shard fetch/worker computation itself —
only the caller's *wait* on it — since shard fetches are memoized
across concurrent callers
([02-index-format.md](02-index-format.md#caching--offline-support)),
and cancelling a fetch another still-active query depends on would be
wrong. The aborted call's own fetch still completes in the background
and warms the cache for the next query; it just never resolves for the
caller who aborted. Fires/rejects identically whether the query is
running on the main thread or inside a Worker.

### Streaming/incremental results

For instant-search UX, a callback-based variant avoids waiting for the
slowest sub-step (fuzzy/synonym expansion) to show the fast path:

```ts
const final = await client.searchStream("wigdet", {
  fuzzy: true,
  onPartial: (partial) => renderResults(partial), // fires with exact/prefix matches first, only when synonyms/fuzzy was requested
  signal: abortController.signal,
});
renderResults(final); // resolves to the same final SearchResult search() would
```

`searchStream()` resolves to the exact same `SearchResult` `search()`
would for the same `query`/options; the only difference is that when
`synonyms` and/or `fuzzy` was requested, `options.onPartial` fires once
with the fast literal/prefix-only pass before the returned promise
resolves to the synonym/fuzzy-expanded final pass — so
`client.search(query, opts)` is equivalent to `client.searchStream(query,
opts)` with `onPartial` simply not read. When neither `synonyms` nor
`fuzzy` was requested there's nothing to expand, so only one pass runs
and `onPartial` is never invoked. Works identically in Worker and
main-thread mode. `signal` behaves exactly as in
[Cancellation](#cancellation) above, with one addition: `onPartial` is
guarded to never fire once `signal` has already aborted, so an aborted
caller gets nothing delivered at all (partial or final) — matching, not
extending, the "an abort only cancels the caller's wait, not the
underlying work" rule described there.

### Disposal

```ts
client.dispose(); // terminates the underlying worker (if any) and rejects any in-flight requests
```

Always call this when a `SearchClient` instance is no longer needed
(e.g. component unmount) — an undisposed worker keeps running and its
pending requests would otherwise never settle if the page keeps a
stale reference around.

### Offline caching

```ts
import { registerOfflineCaching } from "@csf/client";

await registerOfflineCaching(
  new URL("@csf/client/dist/sw.js", import.meta.url), // like workerUrl, not auto-resolved -- see below
  "https://cdn.example.com/search-index/manifest.json",
  {
    mode: "cache-first",       // default; or "stale-while-revalidate"
    languages: ["en"],         // optional -- omit to precache every language's shards
  },
);
```

A standalone function, not a `SearchClient` method — registering the
Service Worker is a one-time, page-lifetime concern independent of any
particular client instance. On `install`, the Service Worker precaches
the manifest plus every shard file (or, with `languages`, only the
selected languages' term/pins/synonym/fuzzy shards — facet and
doc-store shards aren't per-language, so they're always cached in
full); after that, search works fully offline, since the index is
100% static files to begin with. `swUrl` isn't auto-resolved for the
same reason `workerUrl` isn't above — every bundler has its own
incompatible convention for referencing a sibling worker file from a
library, so pass whatever URL your build/CDN actually serves `sw.js`
at. See [08-modern-features.md#caching--offline-support](08-modern-features.md#caching--offline-support)
for the caching-strategy details and cache-invalidation reasoning.

### Error handling & degradation (implemented)

- A failed shard fetch throws a plain `Error` from the `search()` call
  (propagated through the worker as an `error` message when running in
  one) — there's no soft-fail/partial-results mode yet (see Target API
  below). A failed fetch is evicted from the in-memory cache, so a
  later retry gets a fresh attempt rather than replaying the same
  cached rejection forever.
- The manifest is structurally validated right after it's fetched (both
  in worker and main-thread mode) — a corrupt, stale, or incompatible
  manifest throws a clear `InvalidManifestError` from `ready()` instead
  of failing deep inside query execution against `undefined` fields.
- By default, every shard file the manifest references must resolve to
  the same origin as the manifest itself; a manifest pointing at a
  cross-origin shard URL is rejected unless the caller explicitly opts
  in with `allowCrossOriginShards: true` on `SearchClientOptions` — a
  compromised or misconfigured manifest shouldn't be able to make the
  client fetch arbitrary third-party URLs.
- If Web Workers are unavailable (rare, e.g. certain locked-down
  embedded webviews) or `workerUrl` is omitted, the client transparently
  runs on the main thread instead of failing to initialize — same
  public API either way.
- If the underlying worker hits a fatal, unrecoverable error (an
  `error`/`messageerror` event, not a per-request failure), every
  currently-pending `search()` call rejects with that error rather than
  hanging forever.

## Target API (not yet implemented)

Everything in this section is design-only. Option and method names here
are proposed, not stable — expect them to change shape before they're
actually built. Don't copy these as working examples.

### Extended search options

```ts
const result = await client.search("wireless keyboard", {
  page: { size: 10, offset: 0 },
  sort: "relevance",            // or { field: "publishedAt", order: "desc" }
});

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
normal fetch cost. Because it's speculative rather than user-blocking,
`preload()` fetches are deprioritized and network/data-saver-aware by
default — see
[18-resource-aware-loading.md](18-resource-aware-loading.md#network-priority-not-just-laziness) —
unlike an actual `search()` call, which always fetches immediately since
the user is directly waiting on it.

### Suggestions / autocomplete

```ts
const suggestions = await client.suggest("widg", { limit: 5 });
// → prefix-matched terms/phrases from the corpus, for a typeahead dropdown
```

### Federated / multi-index search

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

### Soft-fail partial results

```ts
onFetchError: "soft" | "throw"
```

Network failure fetching a shard → that shard's terms are treated as
"no matches" for a `should` clause (soft-fail) but surfaces a
`result.warnings` entry, or hard-fails a `must` clause with a thrown
`PartialIndexError` — since a partial static hosting outage shouldn't
necessarily null out an entire search UI. Today, any shard fetch
failure just throws.

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
