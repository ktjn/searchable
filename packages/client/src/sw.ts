/// <reference lib="webworker" />
import type { Manifest } from "@ktjn/searchable-format";
import { resolve } from "./url.js";
import { validateManifest } from "./validate-manifest.js";

declare const self: ServiceWorkerGlobalScope;

/**
 * Offline Service Worker (docs/guides/offline-search.md),
 * registered via `registerOfflineCaching()` (packages/client/src/offline.ts).
 * Config (`indexUrl`, `mode`, `languages`) travels as query params on
 * this script's own URL -- the standard way to pass data into a
 * Service Worker registration, since `register()` itself only accepts
 * a script URL, not an options payload the worker can read back.
 *
 * Deliberately one flat cache (`CACHE_NAME`, not versioned per
 * `manifest.buildId`): every shard file this precaches is already
 * content-hashed (docs/concepts/index-format.md#versioning-and-cache-strategy),
 * so a new build's shard URLs simply differ from the old build's --
 * `cache.put()` naturally overwrites only the (non-hashed, stable)
 * manifest URL's entry on each install, and old shard entries just
 * become unreferenced dead weight rather than ever being served
 * incorrectly. Pruning that dead weight is a known future
 * improvement, not attempted here.
 *
 * The manifest entry doubles as the install's commit marker: `precache()`
 * caches every referenced shard before writing it, so a failed install
 * never replaces the previously-active manifest with one whose shards
 * aren't all cached from the same build (docs/guides/offline-search.md).
 */
const CACHE_NAME = "searchable-offline";

function parseConfig(): {
  indexUrl: string;
  mode: "cache-first" | "stale-while-revalidate";
  languages?: string[];
  allowCrossOriginShards: boolean;
} {
  const params = new URL(self.location.href).searchParams;
  const indexUrl = params.get("indexUrl");
  if (!indexUrl) {
    throw new Error(
      "searchable offline Service Worker: missing required 'indexUrl' query param on its own script URL -- register it via registerOfflineCaching(), not directly",
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
    allowCrossOriginShards: params.get("allowCrossOriginShards") === "1",
    ...(languagesParam ? { languages: languagesParam.split(",") } : {}),
  };
}

/**
 * Every shard file URL the manifest references, optionally restricted
 * to `languages` -- a per-language subset lets a deployment precache
 * only the visitor's current UI language instead of paying to cache
 * every language's shards. Facet and doc-store shards aren't
 * per-language (docs/concepts/index-format.md#manifest) so `languages`
 * doesn't apply to them. `fuzzy` is handled separately from
 * `pins`/`synonyms` below because its value is `{file, format?}`, not a
 * bare file string like those two -- iterating all three the same way
 * would push the whole descriptor object through `resolve()` instead of
 * its `.file` string. `vectors.shards` is included too, so
 * `mode: "vector"`/`"hybrid"` are actually offline-capable, not just
 * `mode: "lexical"`.
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
  for (const table of [manifest.pins, manifest.synonyms]) {
    for (const [lang, file] of Object.entries(table ?? {})) {
      if (includesLang(lang)) urls.push(resolve(indexUrl, file));
    }
  }
  for (const [lang, descriptor] of Object.entries(manifest.fuzzy ?? {})) {
    if (includesLang(lang)) urls.push(resolve(indexUrl, descriptor.file));
  }
  for (const [lang, file] of Object.entries(manifest.vectors?.shards ?? {})) {
    if (includesLang(lang)) urls.push(resolve(indexUrl, file));
  }
  return urls;
}

async function precache(): Promise<void> {
  const { indexUrl, languages, allowCrossOriginShards } = parseConfig();
  // no-store: an install must always see the *current* deployment's
  // manifest, never a heuristic HTTP-cache hit for the same URL from an
  // earlier version.
  const manifestResponse = await fetch(indexUrl, { cache: "no-store" });
  if (!manifestResponse.ok) {
    throw new Error(
      `searchable offline Service Worker: failed to fetch manifest ${indexUrl}: HTTP ${manifestResponse.status}`,
    );
  }
  const rawManifest: Manifest = await manifestResponse.clone().json();
  // Same validation the main-thread/Worker query paths already run
  // before trusting a fetched manifest (client.ts, worker.ts) -- without
  // it, a malformed or cross-origin-shard-pointing manifest would get
  // precached (and later blindly served) by this Service Worker alone,
  // the one ingestion path that skipped it.
  const manifest = validateManifest(rawManifest, indexUrl, {
    allowCrossOriginShards,
  });

  // Fetch every referenced shard up front, checking each response, then
  // write them all *before* the manifest. The manifest entry is the
  // commit marker for the install: replacing it only after every shard is
  // safely in the cache means a failed install (one shard 404s, a write
  // throws, ...) can never leave the previously-active Worker serving a
  // new manifest whose shards aren't all cached -- the old manifest entry
  // still points at the old, fully-cached, content-hashed shards. Shards
  // partially written by a failed attempt are unreachable until a later
  // successful commit overwrites the manifest, so they're harmless.
  // Deliberately explicit fetch+put rather than cache.addAll() so each
  // response's status is validated and the commit point stays obvious.
  const shardUrls = shardUrlsFor(manifest, indexUrl, languages);
  const shardResponses = await Promise.all(
    shardUrls.map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          `searchable offline Service Worker: failed to precache ${url}: HTTP ${response.status}`,
        );
      }
      return [url, response] as const;
    }),
  );

  const cache = await caches.open(CACHE_NAME);
  for (const [url, response] of shardResponses) {
    await cache.put(url, response);
  }
  await cache.put(indexUrl, manifestResponse);
}

/** Only requests under the manifest's own directory are ever intercepted -- everything else (unrelated page traffic) passes straight through, untouched, so this Service Worker's presence never adds latency to requests it has nothing to do with. */
function isIndexRequest(requestUrl: string, indexUrl: string): boolean {
  const indexDir = indexUrl.slice(0, indexUrl.lastIndexOf("/") + 1);
  return requestUrl === indexUrl || requestUrl.startsWith(indexDir);
}

/**
 * Serves from this Service Worker's own `CACHE_NAME` only — never from
 * `caches.match()`, which searches every cache the origin owns and could
 * return an entry some unrelated page/app cached under the same request
 * URL (`searchable-offline` is the authoritative, versioned home for this
 * index).
 */
async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  return cached ?? fetch(request);
}

async function staleWhileRevalidate(
  request: Request,
  event: ExtendableEvent,
): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  // `networkUpdate` resolves only after a successful cache write *and* the
  // network response both complete, so the lifetime registered with
  // event.waitUntil() below genuinely covers cache persistence -- not just
  // the fetch. A failed or non-OK response is returned but never written
  // (and never replaces an existing good cached entry).
  const networkUpdate = fetch(request).then(async (response) => {
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  });
  event.waitUntil(networkUpdate.catch(() => undefined));
  // With no cached response the caller's answer is the refresh itself,
  // which now also awaits persistence.
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
