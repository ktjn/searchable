export interface OfflineCacheOptions {
  /**
   * Which caching strategy the Service Worker (packages/client/src/sw.ts)
   * uses for requests under `indexUrl`'s own directory
   * (docs/guides/offline-search.md).
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
  /**
   * Same allowance and same meaning as `SearchClientOptions.allowCrossOriginShards`
   * (`client.ts`) -- off by default, so a compromised or misconfigured
   * manifest can't make the Service Worker precache (and later blindly
   * serve) arbitrary cross-origin URLs. The Service Worker validates
   * the fetched manifest with the same `validateManifest()` the
   * main-thread/Worker query paths already use before trusting it
   * (`sw.ts`'s `precache()`), so this needs to be threaded through the
   * same way `mode`/`languages` are: as a query param on the
   * registration URL, since `register()` only accepts a script URL.
   */
  allowCrossOriginShards?: boolean;
  /**
   * Explicit scope for the Service Worker registration, passed through
   * to `navigator.serviceWorker.register(url, { scope })`. Without it a
   * Service Worker hosted below the app root (e.g. under `/assets/`,
   * minted by a bundler) only intercepts requests under its own
   * directory and will never see the application's index/search traffic
   * outside that path. Prefer serving `sw.js` at the root (`/sw.js`),
   * whose default scope is already `/`; otherwise pass the desired
   * scope here *and* serve `Service-Worker-Allowed: <scope>` on the
   * script response, or `register()` rejects the broader scope
   * (docs/guides/offline-search.md).
   */
  scope?: string;
}

/**
 * Registers the offline Service Worker (packages/client/src/sw.ts,
 * built to dist/sw.js) against `indexUrl`
 * (docs/guides/offline-search.md) -- on install
 * it precaches the manifest plus every shard file `options.languages`
 * selects (or the whole manifest if omitted), then serves matching
 * requests per `options.mode` on every subsequent load, including
 * fully offline, since the index is 100% static files to begin with.
 *
 * Both `swUrl` and `indexUrl` may be relative; each is resolved
 * against the current page's URL at this boundary, so a caller can pass
 * whatever forms their build/CDN uses without pre-normalizing. Config
 * travels as query params appended to the (now absolute) `swUrl` -- the
 * standard way to pass data into a Service Worker registration, since
 * `register()` only accepts a script URL -- and the Service Worker
 * reads them back off its own `location.search`.
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
  const base = globalThis.location?.href;
  const absoluteSwUrl = new URL(swUrl, base);
  const absoluteIndexUrl = new URL(indexUrl, base).href;

  absoluteSwUrl.searchParams.set("indexUrl", absoluteIndexUrl);
  absoluteSwUrl.searchParams.set("mode", options.mode ?? "cache-first");
  if (options.languages) {
    absoluteSwUrl.searchParams.set("languages", options.languages.join(","));
  }
  if (options.allowCrossOriginShards) {
    absoluteSwUrl.searchParams.set("allowCrossOriginShards", "1");
  }
  return navigator.serviceWorker.register(absoluteSwUrl, {
    type: "module",
    ...(options.scope ? { scope: options.scope } : {}),
  });
}
