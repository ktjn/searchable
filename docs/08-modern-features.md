# Modern Features

Cross-cutting capabilities that aren't specific to indexing, ranking, or
facets individually but are expected of a "modern" search experience.

## Web Worker execution

All analysis, scoring, and facet aggregation runs off the main thread by
default (`worker: true`), so a burst of keystroke-driven queries never
janks scrolling/typing. The main-thread `SearchClient` is a thin
message-passing proxy with the same async surface regardless of
`worker: true/false`, so toggling it is a config change, not an API
change — `search()` and `ready()` return the same promises either way,
and the direct-execution code path isn't a separate legacy
implementation, it's the exact code the worker itself runs (`worker.ts`
imports the same `search()` used on the main thread), just invoked
in-process when no worker is used.

Implementation is a small hand-rolled request/response protocol keyed
by an incrementing request id (`{type, id, ...}` in, `{type: "result"
| "error", id, ...}` out) — not Comlink; a generic proxy-based RPC
library would be solving a problem this project doesn't have when the
whole message surface is one method (`search`) plus an `init` handshake.
Transferable `ArrayBuffer`s for shard payloads and the time-slicing/
resource-awareness behavior in
[18-resource-aware-loading.md](18-resource-aware-loading.md) remain
future refinements, not yet implemented — today's protocol passes
plain JSON-shaped messages via structured clone, which is correct but
not yet optimized for large payloads crossing the thread boundary.

**The worker file is not auto-discovered.** `SearchClient` takes an
explicit `workerUrl` alongside `worker: true`
([07-client-api.md](07-client-api.md#initialization)) rather than
resolving its own sibling `worker.js` via `new URL("./worker.js",
import.meta.url)`. That pattern looks appealing but every bundler
(Vite in particular) statically detects and rewrites it under its own
app-bundling assumptions — in Vite's case, rewriting it to a hardcoded
absolute `/assets/...` path that's wrong for a library consumed from an
arbitrary base path, or in the worst case inlining raw unbundled
TypeScript source as a base64 `data:` URL. Requiring an explicit
`workerUrl` sidesteps every bundler's incompatible convention at once,
which is a more robust default than picking one bundler to special-case
for.

## Optional WASM core

For large indexes (hundreds of thousands of documents) or high-frequency
instant-search, posting-list intersection and BM25 scoring are the hot
path. A `plugin:wasm-core` (Rust, compiled via `wasm-bindgen`) implements
the same scoring/intersection logic as the pure-JS core with the same
input/output contract, swappable at init time (`engine: "js" | "wasm"`).
The pure-JS core remains the default and the only required path — WASM is
an opt-in performance upgrade, not a hard dependency, since it adds a
binary payload and a load-time cost that only pays off past a certain
corpus size.

## Index build profiles

Rather than exposing only fine-grained knobs (BM25 `k1`/`b`, shard size
budget, fuzzy max-edits) individually, the indexer also offers named
presets — borrowed from FlexSearch's `memory`/`performance`/`match`/
`score` presets (see
[12-competitive-landscape.md](12-competitive-landscape.md#features-worth-cherry-picking)) —
since most authors want a sensible trade-off choice, not a formula to
tune by hand:

| Profile | Trades off | Good for |
|---|---|---|
| `balanced` (default) | — | most sites |
| `compact` | smaller index (fewer stored positions/fields), faster fetch | large corpora, bandwidth-constrained |
| `precise` | larger index (more positions, finer shard prefixes, fuzzy distance 2) | relevance-critical search (e.g. e-commerce) |
| `fast` | favors smaller shards and fewer stored fields over ranking nuance | instant-search-heavy UIs prioritizing latency |

Every named profile is just a documented bundle of the same underlying
manifest/build settings described elsewhere in these docs — an author
can start from a profile and override individual fields, rather than
choosing between "use the preset" or "configure everything from scratch."

## Caching & offline support

- **HTTP layer**: content-hashed shards are cached by the browser's
  normal HTTP cache per [02-index-format.md](02-index-format.md#versioning--cache-strategy);
  no custom cache logic needed at this layer.
- **In-memory LRU**: the client keeps parsed (not just fetched) shards
  in memory across queries in a session, since parsing JSON/decoding
  binary shards repeatedly is wasted work even with a warm HTTP cache.
- **IndexedDB persistence** (opt-in, `persist: true`): borrowed from
  FlexSearch's persistent-storage adapters (see
  [12-competitive-landscape.md](12-competitive-landscape.md#features-worth-cherry-picking)) —
  caches *parsed* shard data in IndexedDB, keyed by content hash, so a
  returning visitor within the same origin skips both the network fetch
  and the parse step entirely, not just the network fetch (which the
  HTTP cache alone already gives you). This is a separate, smaller layer
  from the full offline Service Worker mode below — useful even for
  sites that don't need full offline capability, just faster warm
  starts.
- **Service Worker / offline mode** (opt-in `plugin:offline`): registers
  a Service Worker that precaches the manifest + all shards (or a
  configurable subset, e.g. just the user's current language) so search
  works fully offline in a PWA — a natural fit since the index is 100%
  static files to begin with, this is "just" a caching strategy
  (stale-while-revalidate or cache-first, configurable) on top of
  artifacts that already exist.

## Highlighting & snippets

**Status**: A first slice is built —
[`packages/client/src/highlight.ts`](../packages/client/src/highlight.ts)'s
`highlightText()`, wired into `search(query, { highlight: true })`,
populates `Hit.highlights: Record<string, HighlightSpan[]>` (one
`{ text, isMatch }[]` array per stored field — today, `title` and
`excerpt`) by matching the literal query terms typed (prefix-aware for
`term*`) against each field's already-stored text. This is deliberately
narrower than the target design below:

- **Literal terms only.** A hit that only matched via synonym expansion
  or fuzzy correction doesn't get that expanded/corrected term
  highlighted — `search()`'s clause-scoring loop doesn't currently
  track which literal real term an expansion match resolved to per
  hit, and highlighting a term the visitor never typed with no way to
  tell it apart from what they searched for would be confusing rather
  than helpful. Revisit once clauses carry that provenance.
- **Whatever's already stored, not the full body.** The doc store
  deliberately doesn't retain full body text
  ([02-index-format.md](02-index-format.md)); the stored per-field
  token *positions* (`FieldPosting.pos`) describe the full body's own
  tokenization, but an excerpt is either author-supplied (`<meta
  name="description">`) or a character-length truncation of the body —
  neither reliably corresponds to those body-token indices, so
  highlighting matches directly against the stored text instead of
  trying to reuse positions that don't actually describe it. This also
  means there's no "highest-scoring window" snippet selection yet
  (there's no full body text to select a window *from*).
- **Structured spans only** — matches the target design below already;
  no raw-HTML convenience string yet.

The original target design, still not fully built:
`plugin:highlight` uses the stored term positions
([02-index-format.md](02-index-format.md#term-shard-inverted-index)) plus
the doc store's stored excerpt text to:
- Wrap matched terms (and their synonym/fuzzy variants) in a configurable
  marker (`<mark>` by default, or a render-prop/callback for
  framework-specific rendering).
- Select the highest-scoring *window* of an excerpt to display (not
  always the start of the field) when the field is long, similar to
  search-engine snippet generation.
- Output is returned as structured spans (`{ text, isMatch }[]`) rather
  than raw HTML by default, so consumers render it however they like
  (React/Vue components, etc.) without a dangerouslySetInnerHTML step;
  a raw-HTML convenience string is available but opt-in, and is always
  escaped except for the highlight markers themselves (see Security below).

## Instant search / debouncing / cancellation

**Status**: The client does not itself impose a debounce (UI-layer
concern — apps differ on desired latency). `search()` and
`facetValues()` accept an `options.signal: AbortSignal`
([`packages/client/src/client.ts`](../packages/client/src/client.ts)) —
a caller passes a fresh `AbortController` per keystroke and aborts the
previous one, guaranteeing a superseded in-flight query's promise
rejects (with a `DOMException` named `"AbortError"`) rather than
resolving and overwriting the latest results, even without an
app-level debounce. Already-aborted signals reject synchronously
before any fetch/worker round trip is even attempted.

Deliberately **does not** cancel the underlying network/worker
operation itself, only the caller's *wait* on it: shard fetches are
memoized across concurrent callers in `ShardCache`
([02-index-format.md](02-index-format.md#caching--offline-support)), so
aborting the shared fetch out from under a different, still-active
query would be wrong. In practice this means an aborted query's shard
fetch still completes in the background and populates the cache
normally (a net win for the *next* query, which gets a warm cache) —
it just never gets delivered to the caller who aborted. Verified with
a real-browser Playwright test proving this behaves identically
whether the query executed inside a Worker or on the main thread.

`searchStream` (see [07-client-api.md](07-client-api.md#streamingincremental-results))
— a callback-based API with `onPartial`/`onComplete` for showing
literal-match results before a slower fuzzy/synonym pass lands — is
still design-only and a larger, separate piece of work: it needs
`search()`'s clause-scoring loop restructured into two sequential
passes (see the doc for that call's own `onPartial`/`onComplete`
contract), not just this cancellation primitive underneath it.

## Accessibility

- Result updates are announced via an `aria-live="polite"` region
  (documented pattern for consuming apps; the core library exposes
  result-count/loading-state changes as plain data, doesn't assume a
  specific DOM structure since rendering is left to the consumer).
- Highlighted match spans use semantic `<mark>` (not just styled
  `<span>`) by default so matches are conveyed non-visually too.
- Facet checkboxes/filters and RTL layout (see
  [03-tokenization-i18n.md](03-tokenization-i18n.md#segmentation)) are
  consuming-app responsibilities, but example components (in a future
  `@csf/react` package) will be built to WAI-ARIA combobox/listbox
  patterns out of the box.

## Security

- No `eval`/`new Function` anywhere in the runtime (CSP-friendly by
  construction — relevant since this runs in arbitrary consumer sites
  that may have strict CSPs).
- Highlighting never injects raw indexed content as HTML without
  escaping; only the highlight marker tags themselves are structural,
  all text content is escaped — prevents stored-XSS if indexed content
  ever contains attacker-controlled text (e.g. user-generated content
  fields).
- Index fetches are plain `fetch()` with credentials mode `omit` by
  default (index files are public static assets, not authenticated
  resources) — an authenticated/private-index mode is a documented
  escape hatch (custom `fetch` implementation injection) but not the
  default posture.

## Bundle size budget

**Status**: A single "core" budget is enforced in CI today
([`packages/client/scripts/check-bundle-size.mjs`](../packages/client/scripts/check-bundle-size.mjs),
run via `pnpm size`) — it gzips the two real entry points a consumer
actually loads (`dist/index.js`, the main-thread bundle; `dist/worker.js`,
the Worker bundle) and fails the build if either exceeds 15 KB gzipped.
Both sit around 1-1.5 KB gzipped today, since facets, pins, synonym
expansion, and fuzzy matching are all baked into the one `@csf/client`
bundle rather than split into separate lazy-loaded entry points.

The table below is the **target** design once a plugin architecture
exists — per-plugin budgets, and a "does importing only core produce a
bundle under budget with zero plugin code included" tree-shaking test —
not what's checked today. Splitting `@csf/client` into a core + opt-in
plugin entry points is unscheduled; revisit once there's a concrete
driver (a consumer that actually needs to shed fuzzy/synonym code they
never call) rather than doing the split speculatively:

| Package | Budget (gzipped) |
|---|---|
| `@csf/client` core | 15 KB |
| `plugin:fuzzy` | 5 KB |
| `plugin:synonyms` | 2 KB |
| `plugin:facets` | 3 KB |
| `plugin:highlight` | 2 KB |
| per-language stemmer (`plugin:lang-*`) | 1-3 KB each |
| `plugin:wasm-core` | separate WASM binary, lazy-loaded, not counted against JS budget |

## Observability hooks

**Status**: A first slice is built —
[`SearchClient.on()`](../packages/client/src/client.ts) exposes `"query"`
(fired synchronously the moment `search()` is called, before any
fetch/worker round trip, with `{query, options}`) and `"result"` (fired
once `search()` resolves, with `{query, options, result}`) — so a
consumer wires up its own analytics (click-through tracking,
zero-result-query logging for content gap analysis) without this
library phoning home or bundling any analytics itself. `on()` returns
an unsubscribe function; a listener that throws doesn't break the
`search()` call it's observing, since it's a side-channel notification,
not part of the query's own control flow. Events fire identically
whether the query actually executed on the main thread or inside a
Worker, since they're emitted from `SearchClient` itself around the
worker-message round trip, not from inside the worker.

Deliberately scoped to `search()` only, not `facetValues()` — "a query
was issued" is naturally about free-text search, and a facet-only
browsing call has no query text for a `"query"` event to carry. Also
scoped to just these two events for now: finer-grained lifecycle
events (shards fetched, scoring complete) and a zero-results event
remain unbuilt — a consumer gets the same information today by
inspecting `result.totalHits` inside its own `"result"` listener, so a
dedicated event isn't a capability gap, just a convenience not yet
added. [spec-diagnostics.md](spec-diagnostics.md) works out the fuller
diagnostics surface these hooks point toward — explain API, query
trace, phase timings, per-plugin attribution — once there's more than
two event types to specify.
