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

## CMS ingestion adapter

The CMS itself isn't named here, so this describes the generic shape;
swap in the specific API of whichever CMS is in use.

**Pull model (recommended default):** the indexer's CMS source adapter
calls the CMS's content API (REST or GraphQL, whichever the CMS
exposes) at build time, paginating through all **published** entries
(explicitly excluding drafts/unpublished content unless a separate
preview index is deliberately wanted), and maps each CMS entry to the
`RawDocument` shape already defined in
[01-architecture.md](01-architecture.md#offline-the-indexer):

```ts
interface RawDocument {
  id: string;                          // CMS entry id
  url: string;                         // computed from the site's routing/slug convention
  fields: Record<string, FieldValue>;  // title, body, tags, etc.
  language?: string;                   // from the CMS's locale field, if multi-locale
  boost?: number;                      // e.g. from a CMS "featured" flag
}
```

Two CMS-shape realities worth calling out explicitly, since they're easy
to get wrong:

- **Structured/rich-text body fields.** Many CMSs don't store body copy
  as a plain string (Contentful rich text nodes, Sanity Portable Text,
  WordPress block JSON, etc.) — the adapter needs an explicit
  "flatten structured content to indexable plain text" step per field
  before it ever reaches tokenization
  ([03-tokenization-i18n.md](03-tokenization-i18n.md#pipeline-stages)).
  This is CMS-specific rendering logic, not something the generic
  analysis pipeline can guess at.
- **Locale-per-entry vs. locale-per-field.** If the CMS is multi-locale,
  confirm whether each entry has one locale (common — maps directly to
  the document-level `language` field) or fields can each carry their
  own locale (rarer) requiring the per-field language tagging noted in
  [03-tokenization-i18n.md](03-tokenization-i18n.md#mixed-language-corpora--queries).

**Rebuild trigger:** a CMS publish webhook fires a CI job that reruns
the full indexer and republishes the static shards. At 2,000 documents,
a full rebuild is fast (well under the timescale of a typical CI job) —
this is a concrete, real answer to the "is incremental indexing worth
the complexity" open question in
[09-roadmap.md](09-roadmap.md#open-questions): at this scale, no, a full
rebuild on every publish event is clearly the simpler and entirely
sufficient choice. Revisit only if a future deployment target is orders
of magnitude larger.

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

[09-roadmap.md](09-roadmap.md)'s Phase 0 calls for "a small multi-language
fixture corpus." Recommend using a real (or realistically shaped)
~2,000-document CMS export as that fixture, in addition to synthetic
Zipfian corpora for the scaling benchmarks in
[10-testing-and-performance.md](10-testing-and-performance.md#macro-benchmarks)
— grounding correctness tests in the actual target deployment shape
catches CMS-content-shape issues (rich text flattening, locale
handling) that a purely synthetic corpus would never surface.
