# Index Format

All index artifacts are static files fetched with plain HTTP GET. Two
serialization tiers are supported (chosen per deployment):

- **JSON tier** (default): human-inspectable, debuggable, gzip/brotli
  compresses very well for text-heavy postings, zero decode dependency.
- **Binary tier** (opt-in, for large corpora): a compact custom format
  (varint-delta-encoded postings, similar in spirit to Lucene's codec)
  for indexes where JSON parse time/size becomes the bottleneck (roughly
  >50k documents). Same logical schema, different bytes on the wire.
  See [11-binary-vs-json-index.md](11-binary-vs-json-index.md) for the
  full analysis of when this tier actually pays for itself (it's less
  about raw bytes-on-the-wire — compression already closes most of that
  gap — and more about avoiding whole-shard parsing and enabling
  HTTP-Range-request random access at large corpus sizes).

Both tiers share the same manifest-driven layout so the client code
mostly doesn't care which tier it's talking to (a `format` field in the
manifest picks the decoder).

## The format is a spec, not a library dependency

The JSON tier is deliberately **just plain JSON with a documented
schema** — no proprietary framing, no required client-side library to
*produce* it. The "indexer" described elsewhere in these docs is a
*reference* implementation, not the only legitimate way to build an
index. Anyone can generate a conforming index with whatever tooling
they already have:

- A Python script using only the standard library (`json`, `gzip`) can
  compute term frequencies and emit `terms/en/w.<hash>.json` in the
  shape defined below — no dependency on this project at all.
- A Node script, a Java batch job inside an existing content pipeline, a
  `psql`/SQL query plus a templating step, or even a spreadsheet macro
  are all equally valid producers, as long as the output matches the
  JSON Schema files in `spec/` (Phase 0 of
  [09-roadmap.md](09-roadmap.md)) and the manifest correctly reports
  `docCount`/`avgFieldLength` for BM25 to work.
- The **runtime only ever needs to read the format**, never write it —
  so "can I generate this from language X" reduces to "does X have a
  JSON encoder and a way to compute term frequencies," which is true of
  nearly every server-side language in common use.

This is why the JSON tier — not the binary tier — is the default and the
recommended starting point: it optimizes for *anyone can produce a valid
index with an afternoon of scripting*, deferring the binary codec (which
does require a purpose-built encoder) to corpora that have actually
outgrown JSON. A minimal reference generator (pseudocode-level, not a
full library) is included under `spec/examples/` in Python and
TypeScript ([20-tech-stack.md](20-tech-stack.md#reference-index-generators-python-and-typescript)),
showing the ~50 lines of tokenize → count → emit-JSON logic needed for a
basic single-field, single-language index, so it's obvious by example
that no framework buy-in is required — other languages are equally
capable of the same thing, these two are just this project's own proof
points.

## Directory layout

```
dist/index/
  manifest.<hash>.json        # entry point, small, short-cached
  terms/<lang>/<prefix>.<hash>.json   # inverted index shards
  facets/<field>.<hash>.json          # facet value -> doc ids + counts
  docs/<shard>.<hash>.json            # doc store shards (render data)
  synonyms/<lang>.<hash>.json         # synonym tables (see doc 05)
  pins/<lang>.<hash>.json             # term-to-page pins (see doc 16)
```

## Manifest

```jsonc
{
  "version": 1,
  "buildId": "2026-07-05T10:22:00Z-9f21a",
  "format": "json", // or "binary"
  "languages": ["en", "de", "ja"],
  "defaultLanguage": "en",
  "fields": {
    "title":   { "boost": 3.0, "stored": true },
    "headings":{ "boost": 2.0, "stored": false },
    "body":    { "boost": 1.0, "stored": false },
    "tags":    { "boost": 1.5, "stored": true, "facet": true }
  },
  "facetFields": ["tags", "category", "publishedYear"],
  "docCount": 18342,
  "avgFieldLength": { "title": 6.1, "body": 412.4 },
  "shards": {
    "terms": [
      { "lang": "en", "prefix": "a", "file": "terms/en/a.7f3c.json", "termCount": 812 },
      { "lang": "en", "prefix": "b", "file": "terms/en/b.2a91.json", "termCount": 640 }
    ],
    "facets": [
      { "field": "tags", "file": "facets/tags.51ee.json" }
    ],
    "docs": [
      { "shard": 0, "file": "docs/0.9c11.json", "idRange": [0, 999] }
    ]
  },
  "synonyms": { "en": "synonyms/en.44bb.json" },
  "pins": { "en": "pins/en.7ab3.json" }
}
```

`avgFieldLength` and `docCount` are stored up front because BM25 needs
corpus-wide statistics (average document length, total doc count) that
must be known without fetching every shard.

## Term shard (inverted index)

Sharded by **language + first-character prefix** of the term (not by
document), so a query for "widget" only ever fetches the `w` shard for
the relevant language(s), regardless of corpus size. Prefix granularity
adapts to corpus size at build time (single-char prefixes for small
corpora, two-char for large ones, chosen so no shard exceeds a target
byte budget, e.g. ~50KB gzipped).

```jsonc
// terms/en/w.7f3c.json
{
  "widget": {
    "df": 214,           // document frequency, for idf
    "postings": [
      { "doc": 41, "fields": { "title": { "tf": 1, "pos": [0], "len": 6 }, "body": { "tf": 3, "pos": [12, 88, 340], "len": 480 } } },
      { "doc": 77, "fields": { "body": { "tf": 1, "pos": [5], "len": 210 } } }
    ]
  },
  "widgets": { "df": 190, "postings": [ /* ... */ ] }
}
```

Positions are retained (not just term frequency) to support phrase
queries and proximity scoring, and to drive highlight snippet selection
without re-fetching document body text. `len` is that document's total
token count for that field — denormalized onto every posting for that
doc/field rather than looked up from a separate shard, because BM25F's
length normalization
([04-query-ranking-boosts.md](04-query-ranking-boosts.md#ranking-model-bm25f))
needs the field length of *every candidate being scored*, not just the
final top-N whose doc-store data gets fetched — so it has to be
available from whatever's already been fetched to evaluate the query,
not from a shard that's only fetched after scoring picks winners. The
repetition (the same doc's field length appearing on every term-posting
for that doc) is small-integer data that compresses away almost
entirely under gzip/brotli, so it costs bytes-on-the-wire, not a second
round trip.

For the binary tier, this becomes: a sorted term dictionary (FST or
simple sorted-array + binary search) mapping term → byte offset into a
postings blob, postings delta-varint-encoded by doc id with a
skip-list every N entries for fast intersection on large posting lists —
directly analogous to how Lucene/Tantivy structure their codecs, just
implemented as a from-scratch minimal format rather than pulling in a
full search library.

## Facet shard

```jsonc
// facets/tags.51ee.json
{
  "type": "terms",              // "terms" | "range" | "hierarchy"
  "values": {
    "javascript": { "count": 412, "docs": [1,2,3, /* delta-encoded in binary tier */] },
    "typescript": { "count": 305, "docs": [4,5,6] }
  }
}
```

Range facets (numeric) precompute bucket boundaries at build time
(configurable, e.g. price buckets) plus store raw sorted values so the
client can also do arbitrary min/max range filters without a bucket
matching exactly.

## Doc store shard

Only fields marked `"stored": true` in the manifest are present here —
this is deliberately *not* the full document, just enough to render a
result card and generate highlights (title, url, a stored excerpt/teaser,
facet display values, thumbnail ref). Sharded by contiguous doc-id ranges
so fetching "doc store data for these 10 hit ids" touches at most a
couple of small shards.

```jsonc
// docs/0.9c11.json — keyed by doc id (string), covering this shard's idRange
{
  "41": {
    "url": "https://example.com/pricing",
    "boost": 2.0,
    "fields": { "title": "Pricing", "excerpt": "Simple, transparent pricing..." }
  }
}
```

Machine-checkable schemas for every shard type on this page live under
[`spec/schema/`](../spec/schema/) (Phase 0 of
[09-roadmap.md](09-roadmap.md)).

## Versioning & cache strategy

- Shard filenames are content hashes → safe to cache
  `immutable, max-age=31536000`.
- `manifest.<hash>.json` — the hash changes every build, so the
  **pointer to the manifest** (e.g. `manifest.json` with no hash, a tiny
  redirect/alias file, or a value baked into the consuming app's HTML at
  deploy time) is the one thing fetched with a short/no-cache policy.
  Two common wiring options are documented in
  [07-client-api.md](07-client-api.md#pinning-a-manifest).
- Old shard sets are harmless leftovers (can be garbage-collected by
  build tooling after N builds); there is no in-place mutation, so a
  client mid-session never sees a half-updated index.

## Compression

All text-heavy shards (terms, docs) are served brotli/gzip pre-compressed
by the static host (standard `Content-Encoding` negotiation — no
custom transport compression needed). Build tooling should emit
`.br` siblings for hosts that support precompressed static serving
(e.g. `terms/en/w.7f3c.json.br`).

## Size targets & sharding tuning

The indexer computes shard sizes at build time and warns (configurable
threshold) if any single shard exceeds a byte budget, and auto-increases
prefix length (e.g. `a`→`ab`,`ac`,...) for over-large shards so no single
keystroke ever triggers a multi-hundred-KB fetch — this is the main lever
for scaling corpus size without a proportional first-query cost.
