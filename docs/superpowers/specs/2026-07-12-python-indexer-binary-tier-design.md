# Python index-creation support: binary storage tier design

Status: approved, not yet implemented.

## Context

Phase 1+2 (PR #13) and Phase 3 (PR #14) shipped a fully-featured
JSON-only Python `csf-indexer`. Per the original decomposition, two
phases remain: vector embeddings and the binary storage tier. This
spec covers the binary storage tier, done first (before vectors) per
explicit direction.

The binary tier is a purely optional, opt-in physical encoding of the
same logical index already produced by `build_index()` — it changes
nothing about *what* gets indexed, only *how* three specific shard
types get serialized to disk. `docs/spec-binary-format.md` (the design
doc governing this format) explicitly states: "Facet, synonym, and
pins shards remain JSON — facets deliberately so ... synonym/pins
because neither has a demonstrated size problem worth the complexity."
This is a permanent design decision in the TS reference, not a
deferred one — so the Python port's scope is exactly the three shard
types the TS side actually implements: term shards, doc store, fuzzy
shards.

## Scope

Port `packages/indexer/src/byte-writer.ts`,
`binary-term-shard.ts`, `binary-doc-store.ts`, `binary-fuzzy-shard.ts`
to Python, and extend `write_index.py` with the three format options
the TS `writeIndex()` already exposes (`termShardFormat`,
`docStoreFormat`, `fuzzyShardFormat`). `build_index.py` is untouched —
the binary tier is purely a `write_index()`-time encoding choice.

## Module layout

Four new modules under `python/csf-indexer/src/csf_indexer/`:

- **`byte_writer.py`** — `ByteWriter` class: `write_varint(value: int)`,
  `write_bytes(data: bytes)`, `write_string(s: str)`,
  `write_float64(value: float)`, `to_bytes() -> bytes`. Simpler than
  the TS original: Python's `bytearray` already handles amortized
  growth internally (`bytearray.extend`/`.append`), so this port omits
  the TS version's manual chunked-buffer growth machinery
  (`#ensure`/`#chunks`/`#buf`) entirely — that complexity exists in JS
  specifically because `Uint8Array` isn't natively resizable. This is
  a deliberate simplification, matching precedent (`safe-dict.ts` was
  similarly not ported, since Python dicts don't have JS's
  prototype-pollution risk). Varint encoding: unsigned LEB128, 7 bits
  per byte, high bit set on all but the last byte — same algorithm as
  the TS original, just without the buffer-growth ceremony around it.
- **`binary_term_shard.py`** — `encode_term_shard_binary(term_shard: dict) -> bytes`.
  Direct port of `encodeTermShardBinary`/`encodePostings`: layout is
  `[directory][postings blob]`. Directory: `varint(termCount)`, then
  per term (sorted): `string(term)`, `varint(byteOffset)`,
  `varint(byteLength)`. Each term's postings blob: `varint(df)`,
  `varint(postingCount)`, then per posting (in existing sorted-by-doc
  order): `varint(docIdDelta)`, `varint(hasBoost ? 1 : 0)`,
  `float64(boost)` if present, `varint(fieldCount)`, then per field
  (sorted by name): `string(fieldName)`, `varint(tf)`, `varint(len)`,
  `varint(positionCount)`, `varint(positionDelta)` per position. Boost
  encoded as float64 (not float32) to avoid the precision loss the TS
  doc comment calls out (`1.8` doesn't round-trip through float32).
- **`binary_doc_store.py`** — `encode_doc_store_binary(shard: dict) -> bytes`.
  Direct port of `encodeDocStoreBinary`: `[directory][records blob]`.
  Directory: `varint(docCount)`, then per document (sorted ascending
  by numeric id): `varint(docIdDelta)`, `varint(byteOffset)`,
  `varint(byteLength)`. Each record: `string(url)`,
  `varint(hasBoost ? 1 : 0)`, `float64(boost)` if present,
  `varint(fieldCount)`, then per field (sorted by name):
  `string(fieldName)`, `string(fieldValue)`.
- **`binary_fuzzy_shard.py`** — `encode_fuzzy_shard_binary(shard: dict) -> bytes`.
  Direct port of `encodeFuzzyShardBinary`: `[maxEdits][directory][deletions blob]`.
  `varint(maxEdits)`, then directory: `varint(variantCount)`, then per
  deletion-variant (sorted): `string(variant)`, `varint(byteOffset)`,
  `varint(byteLength)`. Each variant's blob: `varint(termCount)`, then
  `string(term)` per real term.

## `write_index.py` changes

Three new keyword arguments, named to match the TS option names in
snake_case (matching the port's established naming convention):
`term_shard_format: str = "json"`, `doc_store_format: str = "json"`,
`fuzzy_shard_format: str = "json"` — each `"json"` or `"binary"`.

A new `_write_binary(out_dir: str, rel_path: str, data: bytes) -> str`
helper mirrors the existing `_write_json()`: content-hashes the raw
bytes (reusing `content_hash()`, which already accepts `bytes`), writes
to a `.bin`-suffixed, hash-embedded filename, returns the relative
path. When a shard is written in binary format, its manifest entry
gains `"format": "binary"` (matching `spec/schema/manifest.schema.json`'s
existing `format` enum on term/docs/fuzzy shard entries).

**Critical existing-behavior preservation**: the term-shard
prefix-sharding logic (`_shard_terms_by_prefix`/
`_split_oversized_bucket`, which decides how many prefix buckets to
split a language's term shard into) always measures size via
gzip-compressed **JSON** serialization, regardless of the shard's
final output format — this is what the TS `writeIndex()` does too (a
documented, accepted approximation: binary output size differs from
gzipped-JSON size, but the splitting heuristic doesn't specifically
account for that). This plan makes **no changes** to that sizing logic
— only the final per-bucket encode+write step branches on
`term_shard_format`. Same principle for doc-store chunking
(`doc_store_shard_size`) and fuzzy shards — chunking/language-iteration
logic is format-independent, only the final write differs.

Facets, synonyms, pins sections are completely unaffected by this
plan — no format option exists for them, matching the permanent
TS design decision.

## Testing

- `byte_writer.py`: hand-computed expected-byte-sequence tests for
  varint boundary values (`0`, `127`, `128`, `16383`, `16384`, larger
  multi-byte values), UTF-8 strings (including non-ASCII), and
  float64 — verified against the LEB128/IEEE-754 spec directly, not by
  round-tripping through a decoder we wrote ourselves.
- Each encoder (`binary_term_shard.py`/`binary_doc_store.py`/
  `binary_fuzzy_shard.py`): hand-computed expected byte sequences for
  small, fully worked-out fixtures (e.g. a 2-term shard with known
  postings) — same independent-verification principle.
- `write_index.py`: confirms binary-format output files exist, are
  non-JSON (don't parse as JSON), are correctly content-hashed
  (filename hash matches `content_hash()` of the actual file bytes),
  and manifest entries carry `"format": "binary"` only when that
  format was actually requested.
- **New, uniquely enabled by this phase's deterministic format**: a
  TS-side test extending `cross-implementation-conformance-python-indexer.test.ts`
  that builds the *same* small fixture on both the TS and Python
  sides with `termShardFormat`/`docStoreFormat`/`fuzzyShardFormat: "binary"`
  (TS) / `term_shard_format`/etc. `"binary"` (Python), and asserts the
  raw `.bin` file bytes are **byte-identical** between the two
  implementations, read directly via Node's `fs.readFileSync` and
  compared as buffers — the strongest possible cross-implementation
  guarantee available in this project, since (unlike lexical
  tokenization) there's no legitimate source of variance to excuse a
  byte difference here.
- End-to-end: a Python-built binary index (all three formats set to
  `"binary"`) served over real HTTP and queried via the real
  `SearchClient`, proving `@csf/client`'s actual binary decoder — the
  real consumer — can read Python-produced binary shards, not merely
  that the bytes match TS's own output byte-for-byte (though the
  byte-identical test above already implies this, this is
  defense-in-depth given the whole point of index creation is
  producing something the client can actually query).

## Out of scope

Vector embeddings and their binary shard format remain a separate,
not-yet-started phase. Any future binary encoding for facet/synonym/
pins shards (per `docs/spec-binary-format.md`'s "still a draft, not
yet implemented" note) is out of scope here too — it isn't implemented
on the TS side, so there's nothing to port yet.
