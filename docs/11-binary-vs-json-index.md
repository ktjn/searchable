# Investigation: Should the Index Be Served as Binary?

[02-index-format.md](02-index-format.md) already proposes a binary tier
as an opt-in. This doc works through *when that's actually worth it*,
since it trades against the "open, trivially-generatable JSON spec"
principle in [00-overview.md](00-overview.md) — binary shouldn't be
adopted as a default without a concrete reason, given that cost.

## What's actually being compared

Not "JSON vs binary" in the abstract — three real cost centers, each of
which binary affects differently:

1. **Bytes on the wire** (after HTTP compression — brotli/gzip, not raw
   bytes, since that's what actually transfers).
2. **Parse/decode time** on the client before the data is usable.
3. **Producibility** — how hard it is for an arbitrary server-side
   language to emit a conforming shard (the open-format goal).

## 1. Bytes on the wire

Postings data is mostly small integers (doc ids, term frequencies,
positions) with a lot of structural repetition (`"doc"`, `"fields"`,
`"tf"`, `"pos"` keys repeated per posting). Brotli/gzip are very good at
exploiting exactly this kind of repetition — compressed JSON postings
are typically not far off from a naively-encoded binary equivalent,
**because the compressor is already doing a lot of the same job an
integer-packing binary format would do by hand.**

Where binary still wins on bytes even after compression:
- **Delta + varint encoding of sorted doc ids** in a posting list
  compresses better than a generic byte-oriented compressor can achieve
  on the equivalent JSON digit strings, because it operates on the
  actual integer values (small deltas → 1 byte) rather than on
  variable-length decimal text.
- At **high posting-list density** (very common terms with huge doc-id
  lists), this gap widens — exactly the shards that matter most for
  fetch latency, since common terms are hit by nearly every query.

Rough shape of the effect (illustrative, not a substitute for the real
benchmark in [10-testing-and-performance.md](10-testing-and-performance.md#2-performance-test-suite)):
JSON+brotli and a hand-rolled delta-varint binary+brotli tend to land
within ~20-30% of each other for typical postings, widening toward
~2x for very dense, highly-clustered doc-id lists (e.g. a term present
in most of the corpus). **Bytes-on-the-wire alone rarely justifies
binary** for small/medium corpora — compression already does most of
the work.

## 2. Parse/decode time

This is where binary's case is actually strong, and it's a *client CPU*
cost, not a network cost, so it doesn't show up if you only measure
transfer size:

- `JSON.parse` on a shard must materialize every posting as a full JS
  object (`{doc, fields: {title: {tf, pos}, ...}}`) before any of it is
  usable — allocation-heavy, and all-or-nothing (can't start using term
  A's postings before term Z in the same shard has finished parsing).
- A binary format with a **term dictionary + byte offsets** (sorted
  array or FST mapping term → offset into a postings blob) allows
  **random access without parsing the whole shard**: look up the one
  term's offset, decode only that term's postings. This matters most
  for shards containing many terms where a query only ever wants one of
  them per fetch — which is the normal case.
- This also composes with **HTTP Range requests**: if the postings blob
  is a single large binary file with a term-offset index fetched once,
  subsequent queries can `Range: bytes=X-Y` fetch just the needed
  posting list instead of a whole prefix-shard file — a capability the
  JSON-shard-per-prefix scheme doesn't have an equivalent for (JSON
  shards are fetched/parsed whole). This is a genuinely different
  scaling property, not just a constant-factor win, and is the strongest
  concrete argument for binary at large corpus sizes.

## 3. Producibility (the open-format goal)

This is binary's real cost, and it's the one that matters most given
this project's stated principles:

- A sorted-array-of-varints-plus-offset-table format is still
  *implementable* from Python/Node/Java with only standard-library
  tooling (`struct`, `DataView`/`Buffer`, `ByteBuffer` — no exotic
  dependency), so it doesn't violate the open-format principle outright.
- But it is meaningfully **more code, and more ways to get it subtly
  wrong**, than "call your language's JSON encoder": endianness, varint
  encoding details, offset-table alignment, and integer overflow
  handling all need to match the spec exactly, or you get a shard that
  looks fine but silently corrupts a lookup for a specific edge case.
  This directly increases the surface area the cross-implementation
  conformance tests in
  [10-testing-and-performance.md](10-testing-and-performance.md#1-correctness-tests)
  need to cover, and raises the bar for "an afternoon of scripting can
  produce a valid index" from Phase 0 of
  [09-roadmap.md](09-roadmap.md#phase-0--spec--fixtures).
- We should **not** reach for a heavyweight schema/serialization
  framework (FlatBuffers, Cap'n Proto, Protobuf) to get zero-copy
  binary access — that reintroduces a library/toolchain dependency on
  the *producer* side, which directly undercuts "generatable by simple
  means," for a benefit (schema evolution, codegen) this project doesn't
  need. If binary is used, it should be a small, fully hand-specifiable
  byte layout documented in plain prose + a JSON Schema-equivalent
  "binary layout" doc, matching the simplicity principle in
  [00-overview.md](00-overview.md#guiding-principles).

## Recommendation

Keep the tiered design in [02-index-format.md](02-index-format.md), but
sharpen when each tier applies rather than leaving it a vague "opt-in for
large corpora":

- **JSON stays the default and the reference/spec-primary format**,
  full stop — it's what Phase 0-6 of the roadmap build and test against,
  it's what the cross-language conformance suite treats as ground truth,
  and it's what the "generate an index in an afternoon of Python"
  pitch depends on.
- **Binary is justified specifically by the random-access / Range-request
  property (§2), not by bytes-on-the-wire (§1)** — meaning the trigger
  for reaching for it isn't just "corpus is big," it's "shard parse time
  or per-shard byte size is measurably hurting time-to-first-result in
  the performance suite, *and* the corpus is large/dense enough that
  splitting into ever-smaller JSON prefix-shards stops being sufficient."
  The performance suite in
  [10-testing-and-performance.md](10-testing-and-performance.md) should
  report this threshold empirically (a corpus size / shard density
  number) rather than the docs asserting one without data.
- **Binary format spec must be minimal and hand-rollable** — a sorted
  term-offset table + delta-varint posting lists, documented as plain
  bytes-and-offsets prose, not a framework dependency — and must ship
  with reference encode/decode examples in at least two of
  Python/Node/Java from day one (not deferred), so it's proven, not
  assumed, that the openness principle survives the binary tier.
- **The indexer should recommend a tier automatically**: at build time,
  after computing per-shard sizes and corpus stats, print a suggestion
  ("N shards exceed the size budget; consider `--format=binary`") rather
  than requiring the author to guess upfront — keeps the simple path
  (JSON, no flags) the default experience even for authors who will
  eventually need binary.
- Both tiers **must pass the same correctness and conformance test
  suite** ([10-testing-and-performance.md](10-testing-and-performance.md))
  — a binary-tier index and a JSON-tier index built from the same source
  documents must be indistinguishable from the client's point of view
  for every query in the regression snapshot set.

## Follow-up work (tracked in the roadmap)

Added to [09-roadmap.md](09-roadmap.md) Phase 7: build the binary codec
*and* a Range-request-capable single-file postings variant, benchmark
both against JSON at 10k/100k/1M synthetic corpus sizes, and use that
data (not intuition) to set the size/density threshold at which the
indexer's auto-suggestion switches on.
