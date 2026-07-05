# Resource-Aware Loading

Everything so far (Web Worker execution, lazy shard fetch, HTTP/
IndexedDB caching) already avoids the *obvious* ways a client-side
search engine could hurt the host page. This doc closes the remaining
gaps: being a good citizen isn't just "don't block the main thread," it's
also not competing with the page's own critical resources for network
priority, not assuming unlimited bandwidth/memory/battery, and staying
responsive to cancellation even inside a background thread. None of
this is a new feature surface for the *user* — it's entirely about the
engine never being the reason a page feels slow, regardless of whether
search is actively being used.

## Network: priority, not just laziness

Laziness (fetch only the shards a query needs) solves *how much* gets
fetched, not *when relative to everything else on the page*. Two
distinct request classes, treated differently:

- **User-initiated query fetches** (the shards needed for a search the
  user is actively waiting on): issued immediately, no artificial delay
  — the user is waiting, deferring these would be the wrong tradeoff.
- **Speculative fetches** (`preload()`/warm-up hints,
  [07-client-api.md](07-client-api.md#warm-uppreload); prefetched facet
  shards, [06-faceted-search.md](06-faceted-search.md#facet-shard-fetch-strategy)):
  issued with the [Fetch Priority
  hint](https://developer.mozilla.org/docs/Web/API/Request/priority)
  set to `low` (`fetch(url, { priority: "low" })`), and scheduled via
  `requestIdleCallback` (falling back to a short `setTimeout` where
  unavailable) rather than fired synchronously on page load or on every
  keystroke — so warm-up traffic never contends with the page's own
  critical-path resources (hero image, above-the-fold CSS/fonts) for
  bandwidth or HTTP/connection-pool slots.
- **Concurrency cap**: shard fetches (of either class) are capped at a
  small number of simultaneous in-flight requests (default 6, matching
  typical per-origin HTTP/1.1 limits, tunable) so a single query that
  happens to need many shards — or a preload racing an active search —
  can't itself become a burst that starves other page activity;
  additional needed shards queue rather than all firing at once.

## Network-condition and data-saver awareness

Speculative work checks
[`navigator.connection`](https://developer.mozilla.org/docs/Web/API/Navigator/connection)
(Network Information API, where available) before doing anything the
user didn't directly ask for:

- `saveData === true` or `effectiveType` in `"slow-2g"`/`"2g"` →
  `preload()` and facet-shard prefetching are skipped entirely; only
  fetch what a user's actual, explicit action (typing a query, opening
  the facet panel) requires. A deployment can override this via
  `respectDataSaver: false` for cases where the index is small enough
  that it doesn't matter (e.g. the ~2,000-doc CMS target in
  [14-reference-deployment-cms-2k.md](14-reference-deployment-cms-2k.md),
  where total shard size is trivial regardless of connection quality) —
  but the default favors the user's stated preference over the engine's
  convenience.
- Where the API is unavailable (Safari, at time of writing) or unset,
  behavior defaults to the normal (non-restricted) speculative path —
  there's no way to detect "should be cautious" without the signal, and
  guessing conservatively everywhere would needlessly slow down users on
  fine connections just to protect a case there's no way to detect.

## Memory awareness

`navigator.deviceMemory` (where available) sizes the in-memory LRU shard
cache
([08-modern-features.md](08-modern-features.md#caching--offline-support))
at init — a smaller cap on low-memory devices, since holding many
parsed shards (especially vector shards, which are the largest
individual artifacts per
[13-vector-and-hybrid-search.md](13-vector-and-hybrid-search.md#storage-format))
is exactly the kind of background memory pressure that can make the
*rest* of the page (and other tabs) janky, not just this one widget.
Where the API is unavailable, a conservative fixed default cap is used
rather than assuming unlimited memory.

The cache also actively **shrinks on inactivity**: if no query has run
for a configurable idle period (default 2 minutes), the LRU evicts down
to a small floor rather than holding its high-water-mark size
indefinitely on the assumption search might resume — freeing memory back
to the page is treated as the safer default over keeping everything warm
"just in case."

## CPU: time-slicing inside the Worker

Running scoring/facet-aggregation in a Worker
([08-modern-features.md](08-modern-features.md#web-worker-execution))
already keeps the *main* thread free, but a worker running one giant
synchronous computation for hundreds of milliseconds is still worth
avoiding — it delays the worker from noticing a cancellation message
(a superseded query, an `AbortSignal` firing) and, on lower-end/shared
hardware, pins a CPU core for longer than necessary:

- Posting-list intersection, BM25F scoring over large candidate sets,
  and brute-force vector similarity
  ([13-vector-and-hybrid-search.md](13-vector-and-hybrid-search.md#similarity-search-strategy))
  are chunked with an explicit yield (`await scheduler.yield()`, or a
  microtask/macrotask break as a fallback) roughly every few
  milliseconds of work, checking the cancellation flag at each yield
  point — so an aborted query actually stops promptly instead of running
  to completion and being discarded.
- This is a correctness property as much as a citizenship one: without
  it, rapid keystroke-driven queries could pile up worker-side work
  faster than it's ever consumed, since a stale in-flight computation
  wouldn't yield often enough to check whether it's already been
  superseded.

## Cross-thread transfer cost

Passing fetched shard bytes from the fetch (which can happen on the main
thread or in the worker, either way) into the Worker's scoring
computation uses
[Transferable objects](https://developer.mozilla.org/docs/Glossary/Transferable_objects)
(`ArrayBuffer` transfer, not structured-clone copy) for binary-tier
shards, and avoids re-parsing JSON-tier shards more than once by keeping
parsed results in the worker-side cache rather than round-tripping
parsed objects back across the boundary — the RPC layer mentioned in
[08-modern-features.md](08-modern-features.md#web-worker-execution)
is specifically responsible for not silently reintroducing a copy cost
that defeats the point of moving work off the main thread.

## What's deliberately not done here

- No background-sync/periodic-refresh of index data while the page is
  merely open but idle — the manifest/shard versioning model
  ([02-index-format.md](02-index-format.md#versioning--cache-strategy))
  means a stale in-memory index is safe (just possibly a build or two
  behind), so there's no citizenship reason to spend battery/network
  keeping it live-updated in the background.
- No attempt to detect or react to CPU thermal throttling or battery
  level directly — the Battery Status API is deprecated/removed in most
  browsers, and CPU throttling isn't reliably observable from JS; the
  time-slicing approach above is the actually-available lever, not a
  proxy for a signal that doesn't exist.

## Testing implication

Added to [10-testing-and-performance.md](10-testing-and-performance.md)'s
macro-benchmark suite: a **resource-citizenship** check using the
browser's Long Tasks API — asserting that no single task attributable to
this engine (worker or main-thread proxy) exceeds 50ms during a realistic
query burst, and a mocked-`navigator.connection` test confirming
speculative fetches are actually skipped under simulated `saveData`/slow
connection conditions rather than merely documented as skipped.
