/// <reference lib="webworker" />
import type { Manifest } from "@csf/format";

declare const self: ServiceWorkerGlobalScope;

/**
 * Offline Service Worker (docs/08-modern-features.md#caching--offline-support),
 * registered via `registerOfflineCaching()` (packages/client/src/offline.ts).
 * Config (`indexUrl`, `mode`, `languages`) travels as query params on
 * this script's own URL -- the standard way to pass data into a
 * Service Worker registration, since `register()` itself only accepts
 * a script URL, not an options payload the worker can read back.
 *
 * Deliberately one flat cache (`CACHE_NAME`, not versioned per
 * `manifest.buildId`): every shard file this precaches is already
 * content-hashed (docs/02-index-format.md#versioning--cache-strategy),
 * so a new build's shard URLs simply differ from the old build's --
 * `cache.put()` naturally overwrites only the (non-hashed, stable)
 * manifest URL's entry on each install, and old shard entries just
 * become unreferenced dead weight rather than ever being served
 * incorrectly. Pruning that dead weight is a known future
 * improvement, not attempted here.
 */
const CACHE_NAME = "csf-offline";

function resolve(baseUrl: string, relPath: string): string {
  return new URL(relPath, baseUrl).href;
}

function parseConfig(): {
  indexUrl: string;
  mode: "cache-first" | "stale-while-revalidate";
  languages?: string[];
} {
  const params = new URL(self.location.href).searchParams;
  const indexUrl = params.get("indexUrl");
  if (!indexUrl) {
    throw new Error(
      "csf offline Service Worker: missing required 'indexUrl' query param on its own script URL -- register it via registerOfflineCaching(), not directly",
    );
  }
  const mode =
    params.get("mode") === "stale-while-revalidate"
      ? "stale-while-revalidate"
      : "cache-first";
  const languagesParam = params.get("languages");
  return {
    indexUrl,
    mode,
    ...(languagesParam ? { languages: languagesParam.split(",") } : {}),
  };
}

/**
 * Every shard file URL the manifest references, optionally restricted
 * to `languages` -- a per-language subset lets a deployment precache
 * only the visitor's current UI language instead of paying to cache
 * every language's shards. Facet and doc-store shards aren't
 * per-language (docs/02-index-format.md#manifest) so `languages`
 * doesn't apply to them.
 */
function shardUrlsFor(
  manifest: Manifest,
  indexUrl: string,
  languages?: string[],
): string[] {
  const includesLang = (lang: string) => !languages || languages.includes(lang);
  const urls: string[] = [];
  for (const entry of manifest.shards.terms) {
    if (includesLang(entry.lang)) urls.push(resolve(indexUrl, entry.file));
  }
  for (const entry of manifest.shards.facets ?? []) {
    urls.push(resolve(indexUrl, entry.file));
  }
  for (const entry of manifest.shards.docs) {
    urls.push(resolve(indexUrl, entry.file));
  }
  for (const table of [manifest.pins, manifest.synonyms, manifest.fuzzy]) {
    for (const [lang, file] of Object.entries(table ?? {})) {
      if (includesLang(lang)) urls.push(resolve(indexUrl, file));
    }
  }
  return urls;
}

async function precache(): Promise<void> {
  const { indexUrl, languages } = parseConfig();
  const manifestResponse = await fetch(indexUrl);
  const manifest: Manifest = await manifestResponse.clone().json();
  const cache = await caches.open(CACHE_NAME);
  await cache.put(indexUrl, manifestResponse);
  await cache.addAll(shardUrlsFor(manifest, indexUrl, languages));
}

/** Only requests under the manifest's own directory are ever intercepted -- everything else (unrelated page traffic) passes straight through, untouched, so this Service Worker's presence never adds latency to requests it has nothing to do with. */
function isIndexRequest(requestUrl: string, indexUrl: string): boolean {
  const indexDir = indexUrl.slice(0, indexUrl.lastIndexOf("/") + 1);
  return requestUrl === indexUrl || requestUrl.startsWith(indexDir);
}

async function cacheFirst(request: Request): Promise<Response> {
  const cached = await caches.match(request);
  return cached ?? fetch(request);
}

async function staleWhileRevalidate(
  request: Request,
  event: ExtendableEvent,
): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const networkUpdate = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });
  event.waitUntil(networkUpdate.catch(() => undefined));
  return cached ?? networkUpdate;
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const { indexUrl, mode } = parseConfig();
  if (!isIndexRequest(event.request.url, indexUrl)) return;
  event.respondWith(
    mode === "stale-while-revalidate"
      ? staleWhileRevalidate(event.request, event)
      : cacheFirst(event.request),
  );
});
