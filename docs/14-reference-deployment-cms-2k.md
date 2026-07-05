# Reference Deployment: ~2,000 CMS-Sourced Documents

The rest of these docs are written to scale from hundreds to millions of
documents, which means a lot of hedged "past a certain size, consider
X" language. This doc pins down what the design actually looks like for
a concrete, common target — **~2,000 documents pulled from a CMS** — so
there's one unambiguous answer instead of a menu of thresholds. This is
also proposed as the **reference fixture** for Phase 0 of the roadmap
(real target data, not only synthetic benchmarks).

## Rough sizing (illustrative — confirm with the perf suite on real content)

Assuming a fairly typical CMS document (title, some metadata/tags, a
body of a few hundred to ~1,000 words):

| Artifact | Rough size, 2,000 docs |
|---|---|
| Term index (single language, JSON, gzipped) | Low hundreds of KB to ~1-2MB |
| Doc store (title/url/excerpt/facet-display fields, gzipped) | ~100-300KB |
| Facet shards (a handful of facet fields) | Tens of KB total |
| Vector shards (if enabled, ~200-token passages, int8-quantized) | ~1-3MB uncompressed for ~6-8k passages |

**Everything above comfortably fits in a single HTTP round trip per
artifact type.** This is the concrete driver for the "small corpus
mode" flagged as a roadmap consideration (not yet adopted) in
[12-competitive-landscape.md](12-competitive-landscape.md#explicitly-not-cherry-picking):
at this scale, prefix-based term sharding
([02-index-format.md](02-index-format.md#term-shard-inverted-index))
is solving a problem that doesn't exist yet.

## What to simplify at this scale

- **Skip prefix sharding.** Configure the indexer for a single term
  shard per language (still the same shard *format* — a degenerate case
  of the general design, not a different code path) rather than
  splitting by first-character prefix. There's no meaningful fetch-size
  problem to solve by splitting a ~1MB file into 26 pieces.
- **Skip the binary tier entirely.** The whole point of
  [11-binary-vs-json-index.md](11-binary-vs-json-index.md)'s binary tier
  is avoiding whole-shard JSON parse cost and enabling Range-request
  random access — neither matters when the whole term index is ~1MB;
  `JSON.parse` on that is single-digit milliseconds. Use the JSON tier,
  full stop.
- **Skip vector clustering, if vector search is used at all.** At
  ~6-8k passages, brute-force cosine similarity
  ([13-vector-and-hybrid-search.md](13-vector-and-hybrid-search.md#similarity-search-strategy))
  is comfortably within the "low hundreds of thousands" threshold where
  clustering starts to matter — it's a non-issue here.
- **Don't bother with named build profiles.** The `balanced` default
  from [08-modern-features.md](08-modern-features.md#index-build-profiles)
  is fine; `compact`/`fast` exist to trade relevance nuance for fetch
  size at scale, and there's no fetch-size problem to trade against.
- **Keep**: facets, synonyms, fuzzy matching, i18n — none of those are
  scale-driven features, they're content/UX-driven, so they apply (or
  not) based on what the CMS content and site actually need, independent
  of document count.

## Ingestion: from rendered HTML

The initial index is built from **rendered HTML** — the CMS's public
output (crawled live pages, or a static build/export directory) — rather
than by calling the CMS's content API directly. This is a deliberate
simplification, not a stopgap:

- It sidesteps the structured/rich-text flattening problem entirely
  (Contentful rich text nodes, Sanity Portable Text, WordPress block
  JSON, etc. all end up as plain HTML by the time it's rendered) —
  there's exactly one input shape to handle, regardless of which CMS
  produced it.
- It matches how the architecturally-closest prior art (Pagefind) works
  and is the natural fit for the `data-*` attribute authoring convention
  already adopted in
  [12-competitive-landscape.md](12-competitive-landscape.md#features-worth-cherry-picking) —
  that convention now becomes the **primary** ingestion mechanism for
  this deployment, not just an optional adapter alongside a CMS-API one.
- It stays CMS-agnostic: the indexer never needs to know which CMS
  produced the pages, only how to read HTML — consistent with the
  "generatable by simple means" principle, since every mainstream
  language has a small, standard HTML/DOM parsing library (Python:
  `html.parser`/BeautifulSoup; Node: a lightweight DOM parser; Java:
  Jsoup) — heavier than plain JSON-in/JSON-out, but still a single small
  library, not a framework dependency.

**Source adapter:** either (a) crawl the site's sitemap and fetch each
URL, or (b) read a build-output directory of static HTML files directly
(faster, no network round trips, appropriate when the indexer runs in
the same CI pipeline as the site build) — both feed the same HTML→
`RawDocument` extraction step.

**Default extraction rules** are overridable per-page entirely through
meta tags — this is now the CMS's control surface for search behavior,
not just an HTML-parsing detail, so it has its own full reference:
[15-cms-meta-tag-control.md](15-cms-meta-tag-control.md). That doc also
covers term-to-page pinning
([16-term-to-page-pinning.md](16-term-to-page-pinning.md)), which lets
an author guarantee a specific search term surfaces a specific page
regardless of normal ranking — useful at this scale for exactly the
kind of high-intent queries a small CMS-driven site tends to have
("pricing," "contact," "docs").

This gives CMS authors/theme developers a zero-config default (index
`<main>`, use `<title>`/meta description) with an escape hatch for every
field this design cares about (boosts, facets, excerpts, pins) expressed
as plain HTML they already control — no separate config file needed for
the common case, matching
[01-architecture.md](01-architecture.md#offline-the-indexer)'s adapter
model (this is one more source adapter, alongside the JSON-feed/CMS-API
adapters already described there, not a replacement for the general
architecture).

**Rebuild trigger:** since indexing reads rendered output, the indexer
must run **after** the site's build/deploy step completes, not
independently of it — a CMS publish webhook triggers the site rebuild,
and the indexer runs as the last step of that same pipeline (or is
triggered by the site build's completion event) before the new shards
are published. At 2,000 documents, both the site rebuild and the index
rebuild are fast enough that this "full rebuild on every publish"
approach is a concrete, real answer to the "is incremental indexing
worth the complexity" open question in
[09-roadmap.md](09-roadmap.md#open-questions): at this scale, no. Revisit
only if a future deployment target is orders of magnitude larger.

**If a direct CMS-API adapter is wanted later** (e.g. to index draft
content for a preview search UI, or to get structured fields the
rendered HTML doesn't expose, like a raw numeric price for range
facets) — that remains available as an additional adapter per
[01-architecture.md](01-architecture.md#offline-the-indexer); it's not
precluded by starting with HTML, just not needed for the initial index.

## Vector/hybrid search at this scale (optional)

If semantic search over CMS content is wanted: build-time embedding of
~6-8k passages is a small, cheap batch job regardless of whether it
calls a local model or a hosted embedding API during the build (build
time already isn't a "no backend" environment — see
[13-vector-and-hybrid-search.md](13-vector-and-hybrid-search.md#the-hard-constraint-where-does-the-query-embedding-come-from)).
Query-time still needs *some* way to embed the user's query — the
client-side-model-vs-remote-API tradeoff from that doc is unchanged by
corpus size; corpus size only affects the (here, trivial) similarity
search cost, not the query-embedding constraint.

## Using this as the Phase 0 fixture

**Status**: Built — [`@csf/fixtures`](../packages/fixtures) generates
this corpus (hand-written prose, not lorem-ipsum, combined
deterministically per document; marketing pages with authored pins;
blog/docs-style pages with category/tag facets and boosts), used by
real-scale end-to-end tests in both
[`packages/indexer/test/cms-2k-fixture.test.ts`](../packages/indexer/test/cms-2k-fixture.test.ts)
and
[`packages/client/test/cms-2k-fixture.test.ts`](../packages/client/test/cms-2k-fixture.test.ts).
Scoped to English + German only, since those are the only two
LanguageProfiles that exist (docs/09-roadmap.md#status, Phase 4) —
Japanese and Arabic remain unbuilt, so generating pages tagged with
those language codes would just make `buildIndex()` throw
(`getLanguageProfile()` has no profile registered for them). Add them
to the generator once Phase 4 lands those profiles, not before.

[09-roadmap.md](09-roadmap.md)'s Phase 0 calls for "a small multi-language
fixture corpus." A real (or realistically shaped) ~2,000-document CMS
export is the fixture, in addition to synthetic
Zipfian corpora for the scaling benchmarks in
[10-testing-and-performance.md](10-testing-and-performance.md#macro-benchmarks)
— grounding correctness tests in the actual target deployment shape
catches CMS-content-shape issues (rich text flattening, locale
handling) that a purely synthetic corpus would never surface. The
generator's `count` option defaults to a smaller size for fast
correctness-test runs; pass the full ~2,000 (or beyond) when a test
specifically needs deployment-scale volume.
