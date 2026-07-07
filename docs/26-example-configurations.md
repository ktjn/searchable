# Example Configurations

**Relationship to [07-client-api.md](07-client-api.md)**: that doc is
the feature-by-feature API reference (every option, documented where
it's introduced). This doc is the other axis — a complete,
copy-pasteable indexer + `SearchClient` configuration per realistic
deployment scenario, so "I'm building an e-commerce catalog, what do I
actually turn on together" has one answer instead of requiring
assembly from a dozen separate sections. Every option used below is
covered in more depth in 07 (client options) and
[09-roadmap.md](09-roadmap.md)/[04](04-query-ranking-boosts.md)/[06](06-faceted-search.md)/[13](13-vector-and-hybrid-search.md)
(indexer options) — this doc doesn't restate what they do, only how
they combine. [showcase/](../showcase/) is the live, tested version of
several of these (product catalog, synonyms, multi-language); this doc
is the minimal standalone snippet form.

## 1. Small docs/blog site (the minimal case)

A few hundred pages, one language, no facets. The whole point is that
this is *all* the configuration a small deployment needs — every other
section below is opt-in on top of this baseline.

```ts
// build once per deploy, e.g. in a postbuild script
import { buildIndex, writeIndex, discoverHtmlDocuments } from "@csf/indexer";

const sources = await discoverHtmlDocuments("./dist/site");
const built = buildIndex(sources, "en");
await writeIndex(built, "./dist/site/search-index");
```

```ts
// in the browser
import { SearchClient } from "@csf/client";

const client = new SearchClient({
  indexUrl: "/search-index/manifest.json",
  // No workerUrl: runs on the main thread. Fine at this scale — worker
  // execution starts paying for itself once query latency or corpus
  // size grows enough to matter for keystroke-driven search.
});

const { hits } = await client.search("widgets");
```

### Not using Node for the build step?

The index format is a documented spec
([docs/02-index-format.md](02-index-format.md#the-format-is-a-spec-not-a-library-dependency)),
not something only `@csf/indexer` can produce — the browser side above
doesn't change no matter what wrote the manifest/shards it fetches.
[`spec/examples/python/generate_index.py`](../spec/examples/python/generate_index.py)
is a real, working ~100-line reference generator using nothing but
Python's standard library, verified to produce a manifest `@csf/client`
loads and queries correctly
([`packages/client/test/cross-implementation-conformance.test.ts`](../packages/client/test/cross-implementation-conformance.test.ts)):

```sh
python3 generate_index.py documents.json ./dist/site/search-index
```

`documents.json`, a plain JSON array with one object per page:

```json
[
  { "id": 1, "url": "/widgets", "title": "Widgets", "body": "Our widgets are wonderful." },
  { "id": 2, "url": "/gadgets", "title": "Gadgets", "body": "Gadgets and gizmos." }
]
```

The browser-side `SearchClient` snippet above doesn't change at all —
it has no idea which generator produced the manifest it's fetching.

**Scope honestly**: this script is deliberately the minimal case only —
English, `title`/`body` fields at boost 1.0, no facets, no fuzzy
matching, no synonyms, no pinning, no other languages. It exists to
*prove* the format doesn't require Node/TypeScript
([`spec/examples/README.md`](../spec/examples/README.md)'s verified
cross-implementation conformance), not to be a feature-complete
alternative indexer. For anything past section 1's minimal scenario
(facets, fuzzy, i18n, vector search, ...), either use `@csf/indexer` or
extend a from-scratch generator like this one yourself against the
same spec — nothing about the format itself is Node/TypeScript-specific,
only today's *reference* implementation of the fuller feature set.

## 2. E-commerce product catalog

Facets, per-document boosts, curated best-bets, typo tolerance, and
Worker execution so filtering/typing never blocks the main thread —
the combination [showcase/](../showcase/)'s product catalog demo
exercises for real.

```ts
const built = buildIndex(sources, "en", {
  fuzzy: true,
  fuzzyMaxEdits: 1,
  hierarchicalFacets: { category: { separator: ">" } },
  rangeFacetBuckets: { price: [25, 50, 100, 250] },
});
await writeIndex(built, outDir);
```

Per-page metadata driving the above (docs/15-cms-meta-tag-control.md):
`csf-facet-category` (e.g. `"electronics>audio>headphones"`),
`csf-facet-range-price`, `csf-boost` on featured/in-stock items,
`csf-pin`/`csf-pin-priority` for merchandised best-bets.

```ts
const client = new SearchClient({
  indexUrl: "/search-index/manifest.json",
  worker: true,
  workerUrl: new URL("@csf/client/dist/worker.js", import.meta.url),
});

const result = await client.search("headphones", {
  filters: { category: ["electronics>audio"], price: { max: 150 } },
  facets: ["category", "price"],
  fuzzy: true,
  boosts: { fields: { title: 4 } },
});
```

## 3. Multi-language content site

One corpus, several `<html lang>` values, each analyzed under its own
`LanguageProfile` (docs/03-tokenization-i18n.md). No extra client
configuration needed beyond what section 1 already has — the manifest
carries per-language shards and the client resolves the right one per
query automatically via `options.language` or auto-detection.

```ts
// documents in the same discover() pass, each with its own real <html lang>
const built = buildIndex(sources, "en"); // "en" is only the *fallback*
await writeIndex(built, outDir);
```

```ts
// force a specific language (e.g. driven by the page's own UI language)
const result = await client.search(query, { language: "de" });

// or let the manifest's declared per-document languages + query text
// resolve automatically (options.language omitted) -- see
// docs/03-tokenization-i18n.md#auto-language-detection for when this
// fallback kicks in (only pages with no <html lang> at all).

// pair with isRtlLanguage() for RTL layout, no extra query needed:
import { isRtlLanguage } from "@csf/client";
if (isRtlLanguage(result.language)) container.dir = "rtl";
```

## 4. Synonym- and typo-aware search

Authored equivalence classes plus SymSpell fuzzy matching — the
combination the synonym-playground showcase demo exercises.

```ts
const built = buildIndex(sources, "en", {
  fuzzy: true,
  synonyms: {
    en: {
      equivalences: [["couch", "sofa"]],
      directional: { laptop: ["notebook"] }, // "laptop" also matches "notebook", not vice versa
      multiWord: [["new york", "nyc", "big apple"]],
    },
  },
});
```

```ts
const result = await client.search(query, {
  synonyms: true,
  fuzzy: true,
  synonymWeight: 0.5, // default -- lower to favor literal matches over expanded ones
});
```

There's no built-in "this hit only matched via expansion" flag on
`Hit` — to badge expansion-only matches in a UI (as the synonym
playground showcase demo does), run a second, literal-only search
(`{ synonyms: false, fuzzy: false }`) and diff the hit id sets: any id
in the expanded result but not the baseline is expansion-only. Only
worth the extra round trip when actually rendering that distinction,
not on every query.

## 5. Large corpus (scale tier)

Past a few thousand documents, opt into the binary shard tier and
doc-store sharding — both are drop-in `writeIndex()` options with zero
client-side configuration (the client already fetches only the
shard(s) a query needs either way, per
[docs/11-binary-vs-json-index.md](11-binary-vs-json-index.md)).

```ts
const built = buildIndex(sources, "en", { fuzzy: true });
await writeIndex(built, outDir, {
  termShardFormat: "binary",
  fuzzyShardFormat: "binary",
  docStoreFormat: "binary",
  docStoreShardSize: 5000, // splits the doc store past 5k documents
});
```

No client changes at all — `SearchClient` reads the `format: "binary"`
flag each shard's manifest entry carries and decodes accordingly. Below
a few hundred documents, skip all of this (`writeIndex(built, outDir)`
with defaults) — sharding solves a fetch-size problem that doesn't
exist yet at small scale
([docs/14-reference-deployment-cms-2k.md](14-reference-deployment-cms-2k.md#what-to-simplify-at-this-scale)).

## 6. Offline-first PWA

Adds a Service Worker precaching the manifest + shards on install, so
search keeps working with no network at all.

```ts
import { registerOfflineCaching } from "@csf/client";

await registerOfflineCaching(
  new URL("@csf/client/dist/sw.js", import.meta.url),
  "/search-index/manifest.json",
  {
    mode: "stale-while-revalidate", // instant response, refreshes in the background
    languages: ["en"], // only precache the visitor's own language, not every one
  },
);
```

Pairs with any of the sections above unchanged — offline caching wraps
whatever manifest/shards the deployment already builds, it doesn't
require a different indexer configuration.

## 7. Semantic / hybrid search

Adds vector search (via a real local embedding model) alongside lexical
BM25F, combined by Reciprocal Rank Fusion — for finding conceptually
related documents that share no literal query terms
([docs/13-vector-and-hybrid-search.md](13-vector-and-hybrid-search.md)).
The one scenario here needing an extra build-time step and an
optional-`peerDependency` on `@huggingface/transformers`.

```ts
import { buildVectorShards, createTransformersEmbedder } from "@csf/indexer";

const built = buildIndex(sources, "en");
const embedder = await createTransformersEmbedder(); // downloads the default model on first use
const vectors = await buildVectorShards(sources, "en", {
  embed: embedder.embed,
  provider: embedder.provider,
});
await writeIndex(built, outDir, { vectors });
```

```ts
import { createTransformersEmbedQuery } from "@csf/client";

const client = new SearchClient({
  indexUrl: "/search-index/manifest.json",
  embedQuery: createTransformersEmbedQuery(), // same default model as the indexer side
});

const result = await client.search(query, { mode: "hybrid" }); // or "vector" for embedding-only
```

## 8. Instant-search UI (streaming + cancellation)

Renders literal/prefix matches immediately, then upgrades to the
synonym/fuzzy-expanded result — paired with `AbortController` so a
fast-typing user's stale requests never race the latest keystroke.

```ts
let controller: AbortController | undefined;

async function onInput(query: string) {
  controller?.abort();
  controller = new AbortController();
  try {
    const final = await client.searchStream(query, {
      fuzzy: true,
      synonyms: true,
      signal: controller.signal,
      onPartial: (partial) => render(partial.hits), // fast literal-only pass
    });
    render(final.hits); // fuzzy/synonym-expanded pass
  } catch (err) {
    if ((err as Error).name !== "AbortError") throw err;
  }
}
```
