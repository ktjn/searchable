# ADR-0002: JSON-first index format; binary is an opt-in per-shard encoding

## Status

Accepted (implemented: JSON tier since Phase 1; binary tier since
Phase 7 — `packages/indexer/src/binary-*-shard.ts`,
`packages/client/src/binary-*-shard.ts`).

## Context

[02-index-format.md](../02-index-format.md) commits to the index format
being "a spec, not a library dependency" — a Python or Java producer
should be able to emit a conforming index with standard-library tooling
alone, proven by the two independent reference generators in
[`spec/examples/`](../../spec/examples/). [11-binary-vs-json-index.md](../11-binary-vs-json-index.md)'s
benchmarking then asked a separate question: does a binary format pay
for itself at scale, and if so, does it replace JSON or coexist with it?

## Decision

JSON is the default and the format every shard type supports. A binary
encoding exists only where a real, benchmarked win was found — term
shards, fuzzy shards, and the doc store
([spec-binary-format.md](../spec-binary-format.md)) — each per-shard,
selected independently (`Manifest.shards.terms[*].format:
"json" | "binary"`), never a whole-deployment format switch. Facet,
synonym, and pins shards deliberately stay JSON-only: the benchmarking
in 11-binary-vs-json-index.md found no access pattern for them that a
binary encoding would win on (facet shards are usually decoded in full
for aggregate counts, the opposite of the lazy-per-key-decode shape that
makes the binary tier a win for terms/fuzzy/docs).

## Alternatives Considered

- **Binary-only format**: rejected — it would break the "no library
  buy-in, a Python script can produce this" goal, since a from-scratch
  binary codec is a much higher bar for an independent producer than
  JSON, and 11's benchmarking shows the win is real but narrow (large
  dictionaries with lazy per-key access), not universal.
- **A single global format flag on the manifest**: rejected in favor of
  per-shard `format` fields — a deployment might reasonably want a
  binary-encoded term shard (large vocabulary) alongside a JSON facet
  shard (small, aggregate-read), and a global flag can't express that.
- **Whole-shard binary decode**: prototyped and found *slower* than
  native `JSON.parse` at small/medium scale
  ([09-roadmap.md](../09-roadmap.md)'s Phase 7 "Binary-vs-JSON postings
  benchmark" finding) — rejected in favor of the directory-based,
  lazy-per-key-decode design actually shipped, which measured as a real
  win once built that way.

## Consequences

- Every shard type needs its own encoder/decoder pair only where
  benchmarking justified it, not uniformly — more surface area than a
  single codec, but each piece is independently justified and tested
  (`packages/client/test/binary-term-shard.test.ts` and siblings prove
  byte-for-byte-equivalent query results between the JSON and binary
  encodings of the same corpus).
- A consuming deployment opts in per shard type
  (`writeIndex(built, outDir, { termShardFormat: "binary" })`), so
  choosing wrong costs nothing but a rebuild — not a migration.
- The binary tier is marked experimental for 1.0
  ([25-path-to-1.0.md](../25-path-to-1.0.md)'s Scope section): it's real
  and tested, but the newest surface, and a facet-shard binary encoding
  remains an open design question, so it isn't covered by the 1.0
  API-stability guarantee the way the JSON tier is.
