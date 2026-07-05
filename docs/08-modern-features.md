# Modern Features

Cross-cutting capabilities that aren't specific to indexing, ranking, or
facets individually but are expected of a "modern" search experience.

## Web Worker execution

All analysis, scoring, and facet aggregation runs off the main thread by
default (`worker: true`), so a burst of keystroke-driven queries never
janks scrolling/typing. The main-thread `SearchClient` is a thin
message-passing proxy with the same async surface regardless of
`worker: true/false`, so toggling it is a config change, not an API
change. Implementation uses a small RPC layer (Comlink or an in-house
equivalent) rather than hand-rolled `postMessage` protocol per method.

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

- The client does not itself impose a debounce (UI-layer concern — apps
  differ on desired latency), but every method accepts an `AbortSignal`
  and internally guarantees that a superseded in-flight query never
  overwrites the latest results, even without an app-level debounce.
- `searchStream` (see [07-client-api.md](07-client-api.md#streamingincremental-results))
  is the primary building block for a responsive instant-search box.

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

Enforced in CI via a bundle-size check per package:

| Package | Budget (gzipped) |
|---|---|
| `@csf/client` core | 15 KB |
| `plugin:fuzzy` | 5 KB |
| `plugin:synonyms` | 2 KB |
| `plugin:facets` | 3 KB |
| `plugin:highlight` | 2 KB |
| per-language stemmer (`plugin:lang-*`) | 1-3 KB each |
| `plugin:wasm-core` | separate WASM binary, lazy-loaded, not counted against JS budget |

Consumers only pay for plugins they import; tree-shaking is verified in
CI (a "does importing only core produce a bundle under budget with zero
plugin code included" test), not just asserted in docs.

## Observability hooks

`client.on("query", ...)`, `client.on("result", ...)` and similar
lifecycle events (query issued, shards fetched, scoring complete, zero
results) are exposed so consumers can wire up their own analytics
(click-through tracking, zero-result-query logging for content gap
analysis) — the library does not phone home or include any bundled
analytics itself.
