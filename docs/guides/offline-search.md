# Offline search

This guide covers the implemented Service Worker path and the current resource-loading behavior.

Register static search assets for offline use with `registerOfflineCaching`:

```ts
import { registerOfflineCaching } from "@ktjn/searchable-client";

await registerOfflineCaching(
  "/sw.js",
  "/search-index/manifest.json",
  { mode: "cache-first", languages: ["en"] },
);
```

Prefer serving the Service Worker at `/sw.js` (the document root): its default scope is then `/`, so it intercepts the whole application, not just one directory. Both `swUrl` and `indexUrl` may be relative or absolute — each is resolved against the page URL before registration, and the Service Worker only ever sees absolute URLs.

`options.scope` overrides the default scope for deployments that must host the worker script elsewhere:

```ts
await registerOfflineCaching(
  "/assets/sw.js",
  "/search-index/manifest.json",
  { mode: "cache-first", scope: "/" },
);
```

A Service Worker script below the desired scope (like `/assets/sw.js` with `scope: "/"` above) cannot register a broader scope unless its HTTP response also carries `Service-Worker-Allowed: /` — the browser rejects the registration otherwise. Serving the script at `/sw.js` avoids the header entirely, since `scope: "/"` is then its own default scope.

During installation, the Service Worker precaches the manifest, every language-scoped shard for the selected languages, and all shared facet and document-store shards. It uses one flat, non-build-versioned cache named `searchable-offline`: each install replaces the manifest entry, while content-hashed shard filenames ensure the new manifest never refers to stale shard contents. Runtime fetches remain relative to the manifest, and cross-origin shards are rejected unless `allowCrossOriginShards` is explicitly enabled. Cache-first and stale-while-revalidate reads are both isolated to the `searchable-offline` cache, never to other caches the origin may own.

Offline index updates are atomic: on each install, every referenced shard is fetched, validated, and written to the cache *before* the manifest entry is replaced — the manifest is the install's commit marker. If any shard fails (a 404, a network drop, a miswritten deploy), the install fails and the previously active Worker keeps serving the old manifest with its fully cached, content-hashed shards; a partially written new shard is unreachable until a later successful commit. Stale-while-revalidate refreshes likewise extend the Worker's lifetime until a successful network response has actually been persisted to the cache.

Without offline precaching, normal query-time loading is lazy by term prefix and optional feature: facet, synonym, fuzzy, pin, and binary directory resources are requested only by queries that need them. More elaborate network-condition, memory-budget, priority, and speculative-prefetch policies remain proposals in the [roadmap](../project/roadmap.md); the historical design is archived under `docs/archive/specs/`.
