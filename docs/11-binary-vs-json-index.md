# Investigation: Should the Index Be Served as Binary?

See [spec-binary-format.md](spec-binary-format.md) for the concrete
physical layout (sections, encoding, versioning) *if and when* this
investigation concludes binary is worth building — that doc is the
"what it would look like," this doc is the "should we, and when."

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

**Update**: while establishing the JSON-tier half of that baseline (a
prerequisite to any JSON-vs-binary comparison), a real O(n²)
`buildIndex()` performance bug was found and fixed — see the Phase 7
bullet in [09-roadmap.md](09-roadmap.md#phase-7--scale-options) for the
details. Worth calling out here specifically because it changes this
investigation's own premise: the "unsustainable build time at scale"
concern a slow JSON-tier reference indexer might otherwise raise is a
fixed indexer bug, not evidence for or against binary — `buildIndex()`
now scales roughly linearly (~11s at 10k docs, ~153s at 100k, measured
on synthetic corpora via `@csf/fixtures`'s `generateCms2kCorpus()`),
so the actual JSON-vs-binary tradeoff this doc discusses (bytes on the
wire, client-side parse/decode time, producibility) remains exactly as
analyzed above and is unaffected by the fix.

**JSON-tier scaling baseline (measured)**: with the O(n²) fix in place,
`packages/indexer/bench/json-tier-scaling.mjs` (`pnpm bench`) builds real
corpora at 1k/10k/100k documents through the actual
`buildIndex()`/`writeIndex()` pipeline and measures build/write time and
the size/parse time of the shard a query would actually have to fetch.

This benchmark's *first* run found that `writeIndex()` had no real
prefix sharding — every query fetched and parsed the entire per-language
term shard regardless of which term was searched, so per-query cost grew
with total corpus vocabulary instead of staying flat. That's now fixed
(real per-first-character-prefix sharding, auto-widening for over-large
buckets — see the Phase 7 bullet in
[09-roadmap.md](09-roadmap.md#phase-7--scale-options) for the
implementation). Re-running the same benchmark against the fix gives the
real before/after this investigation's "should we build binary" question
actually turns on:

| docs | before: whole-vocab shard (gzip / parse) | after: largest single prefix shard (gzip / parse) |
|---|---|---|
| 1,000 | 178.9 KB / 51 ms | 19.9 KB / 4.9 ms |
| 10,000 | 1.57 MB / 566 ms | 46.8 KB / 12.2 ms |
| 100,000 | 14.83 MB / 6,966 ms | 197.1 KB / 54.5 ms |

Capped at 100k, not the 1M this doc's follow-up work above calls for:
the 100k build alone uses several GB of resident memory in this
reference (in-memory, non-streaming) indexer, and 1M would extrapolate
past the ~15GB available in a typical CI/dev environment. That's a
separate finding about the *reference indexer's* build model (a
practical ceiling well before 1M docs, in-memory and non-streaming),
not evidence about JSON vs. binary as a wire/shard format — a
streaming or out-of-core build could reach 1M docs in either format.

**This is now the right baseline for the JSON-vs-binary question.**
With real prefix sharding, the ~20-30%-to-~2x bytes-on-the-wire gap and
parse-time gap discussed above (both *per-shard-fetched* comparisons)
can be evaluated against what a query actually fetches today — a
~20-200KB gzip prefix shard, not an entire multi-MB vocabulary. At that
size, JSON.parse is already single-digit-to-low-double-digit
milliseconds (4.9-54.5ms across 1k-100k above), well inside "the whole
point of the binary tier is avoiding whole-shard JSON parse cost"
territory this doc's own [14-reference-deployment-cms-2k.md](14-reference-deployment-cms-2k.md)
cross-reference already argues doesn't matter below ~1MB. The remaining
open question the binary tier would answer is narrower than it looked
before this fix: not "avoid parsing the whole vocabulary" (prefix
sharding already does that) but "shrink the *largest* prefix shard
further, for the handful of very common/dense terms whose own posting
lists dominate a shard's size regardless of how finely it's prefixed" —
exactly the residual growth the 1k→100k row above still shows (19.9KB→
197.1KB, ~10x for a 100x corpus increase: real, but far smaller than the
~83x the unsharded vocabulary grew). Building the binary codec should be
benchmarked against *this* baseline (prefix-sharded JSON, largest-shard
numbers above), not the pre-fix unsharded one — the original 10k/100k/1M
benchmarking plan in the roadmap's Phase 7 bullet still stands, just
against the corrected reference point.

**That benchmark is now done.**
`packages/indexer/bench/binary-vs-json-postings.mjs` (`pnpm --filter @csf/indexer run bench:binary`)
takes the same largest-single-prefix-shard baseline as the table above,
encodes it with a minimal delta+varint binary postings codec matching
[spec-binary-format.md](spec-binary-format.md)'s own baseline
recommendation (delta-encoded doc ids, varints throughout, delta-encoded
positions), and measures real gzip size and decode time against the
shard's existing JSON. Every result is round-trip-verified
byte-identical to the JSON source before being reported, so a number is
never published for a broken encoding:

| docs | JSON gzip | binary gzip | size ratio | JSON parse | binary decode | speed ratio |
|---|---|---|---|---|---|---|
| 1,000 | 19.9 KB | 1.8 KB | **11.28x smaller** | 4.6 ms | 10.9 ms | 0.42x (binary slower) |
| 10,000 | 46.8 KB | 1.4 KB | **33.76x smaller** | 11.9 ms | 32.0 ms | 0.37x (binary slower) |
| 100,000 | 197.1 KB | 4.8 KB | **41.00x smaller** | 98.4 ms | 97.0 ms | 1.01x (roughly even) |

Two real, somewhat surprising findings, in opposite directions:

1. **The bytes-on-the-wire win is far bigger than this doc's earlier
   "illustrative" ~20-30%-to-~2x estimate, and it grows with corpus
   size** — 11x at 1k docs, 41x at 100k. The earlier estimate was
   reasoned from first principles about gzip vs. hand-rolled
   integer-packing in the abstract; measuring the *actual* shards this
   codebase produces shows the effect is much larger in practice. The
   shards that end up "largest" (and therefore matter most for
   fetch latency) are dominated by a handful of very common terms with
   large, dense posting lists — precisely the case delta+varint
   doc-id encoding is suited for and gzip's generic LZ77-style
   compression can't reach nearly as well, since gzip compresses
   *repeated byte sequences*, not the *arithmetic structure* of
   ascending integers the way delta-encoding does.
2. **Decoding is currently *slower* than `JSON.parse`, not faster, at
   small-to-medium scale — and only breaks even at 100k.** This directly
   contradicts the "avoid whole-shard JSON parse cost" framing
   [spec-binary-format.md](spec-binary-format.md) leads with, *for this
   specific implementation*: V8's native `JSON.parse` is extremely
   well-optimized C++, while this benchmark's decoder is a naive,
   hand-rolled JavaScript byte-at-a-time loop — a fair baseline
   comparison, but not evidence that binary decoding is inherently
   slower. The gap closes as shards get bigger because `JSON.parse`'s
   cost scales with the much larger *raw text* size while the varint
   decoder's cost scales with the much smaller *binary* size; by 100k
   docs the shard is large enough that binary's smaller total byte
   count starts to offset its slower per-byte decode loop. A real
   implementation has two independent levers this prototype doesn't use
   that could plausibly flip this entirely: **lazy per-term decoding**
   (only decode the postings for terms the query actually matched,
   rather than every term in the shard up front, per
   [spec-binary-format.md](spec-binary-format.md#decoding-strategy)'s
   own "decode lazily" guidance — this benchmark decodes the whole
   shard for a fair apples-to-apples comparison, which is *not* how a
   real client would use it) and a more optimized decoder (a
   typed-array-based bulk varint decode loop, or WASM, neither
   attempted here).

**Revised recommendation**: the bytes-on-the-wire case for binary is
real and substantial — a 41x smaller fetch at 100k docs is not a rounding
error, and shrinking the *largest* prefix shard (this investigation's
remaining open question after the prefix-sharding fix above) is
squarely what it's for. The decode-time story is genuinely unresolved:
this benchmark's naive whole-shard decoder is currently a regression
against `JSON.parse`, so building the binary tier as a straight
whole-shard-decode replacement would trade a real bytes win for a real
latency loss. Building it *well* — lazy per-term posting decode, not
whole-shard — is a prerequisite the next slice of this work needs to
prove out empirically (measuring decode time for *only the matched
term's postings*, not the whole shard) before recommending binary as a
default, not an optional afterthought.

**That prototype is now built and measured.**
`packages/indexer/bench/binary-lazy-decode.mjs`
(`pnpm --filter @csf/indexer run bench:binary-lazy`) re-encodes the same
largest-single-prefix-shard baseline into a directory-based layout — a
sorted term → (byte offset, length) table followed by a postings blob,
per [spec-binary-format.md](spec-binary-format.md#dictionary-encoding)'s
own "sorted string table" baseline and
[#decoding-strategy](spec-binary-format.md#decoding-strategy)'s "decode
only matching posting lists" guidance — so a specific term's postings
can be decoded by seeking directly to its byte range, without touching
(let alone decoding) any other term. Every term's lazy-decoded result is
round-trip-verified against the full JSON-parsed shard before any
number is reported. Simulated queries touch the shard's *busiest* terms
(highest document frequency) — the most expensive plausible case a real
query could hit, not a cherry-picked cheap one:

| docs | shard terms | JSON.parse | directory decode | +1 busiest term (total) | speedup | +3 busiest terms (total) | speedup |
|---|---|---|---|---|---|---|---|
| 1,000 | 57 | 7.98 ms | 0.50 ms | 0.84 ms | **9.5x** | 1.17 ms | **6.8x** |
| 10,000 | 17 | 11.67 ms | 0.04 ms | 1.45 ms | **8.0x** | 3.96 ms | **2.9x** |
| 100,000 | 3 | 96.68 ms | 0.11 ms | 46.32 ms | **2.1x** | 93.65 ms | **1.0x** |

**Lazy per-term decode does flip the finding — for a typical query
touching a handful of terms, binary is now consistently *faster* than
`JSON.parse`, not slower**, reversing the previous benchmark's
whole-shard-decode result across every corpus size tested. But the size
of the win has a real, non-obvious dependency the numbers above expose:
**it shrinks as the shard's own term count shrinks, not just as corpus
size grows.** The 100k-doc case's speedup (2.1x for one term, ~1.0x —
no real win — for three) is much smaller than 1k/10k's (9.5x/8.0x for
one term) not because binary got worse at scale, but because the
*largest* shard at 100k docs happens to pack only 3 extremely dense
terms (a consequence of this project's recursive prefix-splitting
auto-widening down to individual terms once nothing else can be
split off, see the Phase 7 bullet in
[09-roadmap.md](09-roadmap.md#phase-7--scale-options)) — with only 3
terms in the whole shard, decoding "the 3 busiest" is decoding
*almost the entire shard*, which is exactly the whole-shard case the
previous benchmark already measured as a wash-to-slight-loss at that
scale. Lazy decoding's advantage comes from *skipping unused terms*;
a shard with few terms has little to skip. This is a genuinely useful,
non-obvious empirical result: **the value of lazy binary decode is
governed by a shard's vocabulary breadth, not raw corpus size** — a
detail no amount of first-principles reasoning about "avoid parsing the
whole shard" would have surfaced without measuring real shards.

**Updated recommendation**: lazy per-term decode is the right design —
it turns binary from a net loss into a consistent win for the common
case (a shard with tens of distinct terms, which is what most of a real
vocabulary's shards look like; the 3-term 100k-doc shard is the
already-flagged pathological tail case where even one term's own
posting list is enormous). Building the binary tier for real should
implement the directory-based layout this prototype validates —
`spec-binary-format.md`'s "sorted string table + binary search"
baseline plus lazy per-term posting decode — rather than a whole-shard
decode step. The remaining gap before calling this production-ready:
this prototype fully decodes every term *name* in the directory up
front into a `Map` (fast here — sub-millisecond even at 100k docs,
since these shards only hold 3-57 terms), rather than doing
`spec-binary-format.md`'s recommended binary search directly against
the encoded, undecoded byte offsets. A shard with a genuinely large
vocabulary (thousands of terms, e.g. an unsharded `shardByPrefix: false`
small-corpus-mode shard rather than one of these narrow per-prefix
ones) could make that directory-parse step itself non-trivial; that's a
real but bounded follow-up to validate, not a blocker to the
recommendation above.

**Shipped**: the directory-based, lazy-per-term-decode design above is
now a real, opt-in feature, not just a benchmark prototype —
`writeIndex(built, outDir, { termShardFormat: "binary" })`
(`packages/indexer/src/binary-term-shard.ts`,
`packages/client/src/binary-term-shard.ts`). Per-shard, not global
(`format: "binary"` recorded on that specific shard's manifest entry,
per `spec-binary-format.md`'s "a deployment may mix JSON and binary
files" allowance), and deliberately term-shard-only — every other shard
type stays JSON. `packages/client/test/binary-term-shard.test.ts`
builds the same corpus both ways and proves the same real-HTTP
`SearchClient` query returns identical hit ids *and* identical scores
across exact-term, prefix, multi-term AND, phrase, synonym-expanded,
fuzzy-matched, facet-filtered, and document-boosted queries — the
concrete "Binary and JSON indexes must return identical logical search
results" success criterion `spec-binary-format.md` sets, verified
directly rather than assumed. The directory-parse-scales-with-term-count
follow-up flagged just above (true binary search against undecoded
directory bytes, for shards with a much larger vocabulary than any
tested here) remains open for a future slice.
