export interface OfflineCacheOptions {
  /**
   * Which caching strategy the Service Worker (packages/client/src/sw.ts)
   * uses for requests under `indexUrl`'s own directory
   * (docs/08-modern-features.md#caching--offline-support).
   * `"cache-first"` (default): serve from cache if present, only
   * hitting the network on a cache miss -- the strongest offline
   * guarantee, since a served response never depends on network
   * availability once precached.
   * `"stale-while-revalidate"`: serve from cache immediately if
   * present, but *also* kick off a network fetch in the background to
   * refresh the cache for next time -- trades "always freshest" for
   * "instant response," useful when the underlying content updates
   * between deploys and one query's staleness is an acceptable cost.
   */
  mode?: "cache-first" | "stale-while-revalidate";
  /**
   * Restrict precaching to shards for these languages only (e.g. just
   * the visitor's current UI language), instead of the whole
   * manifest -- every deployment's full shard set is a fine default,
   * but not every offline PWA wants to pay to precache every language.
   * Defaults to every language in the manifest.
   */
  languages?: string[];
}

/**
 * Registers the offline Service Worker (packages/client/src/sw.ts,
 * built to dist/sw.js) against `indexUrl`
 * (docs/08-modern-features.md#caching--offline-support) -- on install
 * it precaches the manifest plus every shard file `options.languages`
 * selects (or the whole manifest if omitted), then serves matching
 * requests per `options.mode` on every subsequent load, including
 * fully offline, since the index is 100% static files to begin with.
 *
 * `swUrl` isn't auto-resolved for the same reason
 * `SearchClientOptions.workerUrl` isn't (docs/07-client-api.md) --
 * every bundler has its own incompatible convention for referencing a
 * sibling worker file from a library, so the caller passes whatever
 * URL their build/CDN actually serves `sw.js` at. Config travels as
 * query params appended to `swUrl` (the standard way to pass data into
 * a Service Worker registration, since `register()` only accepts a
 * script URL) -- the Service Worker reads them back off its own
 * `location.search`.
 */
export async function registerOfflineCaching(
  swUrl: string | URL,
  indexUrl: string,
  options: OfflineCacheOptions = {},
): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator)) {
    throw new Error(
      "registerOfflineCaching: Service Workers are not supported in this environment",
    );
  }
  const url = new URL(swUrl, globalThis.location?.href);
  url.searchParams.set("indexUrl", indexUrl);
  url.searchParams.set("mode", options.mode ?? "cache-first");
  if (options.languages) {
    url.searchParams.set("languages", options.languages.join(","));
  }
  return navigator.serviceWorker.register(url, { type: "module" });
}
