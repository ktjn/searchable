# ADR-0002: JSON-first index format

## Status

Accepted (implemented since Phase 1).

## Context

[concepts/index-format.md](../concepts/index-format.md) commits to the index format
being "a spec, not a library dependency" — a Python or Java producer
should be able to emit a conforming index with standard-library tooling
alone, proven by the two independent reference generators in
[`spec/examples/`](../../spec/examples/).

## Decision

JSON is the format every shard type supports. Every shard type uses the
same JSON encoding, making the index easy to produce and inspect with
standard tooling. Facet, synonym, and pins shards follow the same JSON
convention.

## Alternatives Considered

- **A non-JSON format**: rejected — it would break the "no library
  buy-in, a Python script can produce this" goal, since a from-scratch
  custom codec is a much higher bar for an independent producer than
  JSON.

## Consequences

- JSON is trivial for independent producers to emit — any language with
  a JSON library can generate a conforming index.
- JSON is easy to inspect, debug, and validate with standard tooling.
- Native `JSON.parse` is well-optimized in all modern runtimes, keeping
  client-side decode costs low.
