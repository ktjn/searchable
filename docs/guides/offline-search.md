# Offline search

This guide covers the implemented worker and Service Worker paths and the current resource-loading behavior.

Pass both `worker: true` and `workerUrl` to move analysis and scoring off the main thread. The client uses the same manifest, shard cache, options, events, cancellation semantics, and result shapes in worker and direct modes.

Register static search assets for offline use with `registerOfflineCaching`:

```ts
import { registerOfflineCaching } from "@csf/client";

await registerOfflineCaching(
  "/assets/sw.js",
  "/search-index/manifest.json",
  { mode: "cache-first", languages: ["en"] },
);
```

During installation, the Service Worker precaches the manifest, every language-scoped shard for the selected languages, and all shared facet and document-store shards. It uses one flat, non-build-versioned cache named `csf-offline`: each install replaces the manifest entry, while content-hashed shard filenames ensure the new manifest never refers to stale shard contents. Runtime fetches remain relative to the manifest, and cross-origin shards are rejected unless `allowCrossOriginShards` is explicitly enabled.

Without offline precaching, normal query-time loading is lazy by term prefix and optional feature: facet, synonym, fuzzy, pin, binary directory, and vector resources are requested only by queries that need them. More elaborate network-condition, memory-budget, priority, and speculative-prefetch policies remain proposals in the [roadmap](../project/roadmap.md); the historical design is archived under `docs/archive/specs/`.
