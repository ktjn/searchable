# Implementation Roadmap

**Relationship to [09-roadmap.md](09-roadmap.md)**: the "Phase 1-4" below
is a *specification-writing* sequence (which design docs to write next),
a different axis from 09-roadmap.md's "Phase 0-8", which tracks actual
*build* status (what has working code vs. what's design-only) and is
the canonical source for "is X done." A doc phase and a build phase
with the same number here are coincidental, not the same milestone —
e.g. this doc's "Phase 1" (binary format / query planner / storage
specs) has no fixed correspondence to 09-roadmap.md's Phase 1 (the
minimal viable engine, long since built).

This document identifies the remaining major technical specifications that should be written before the project reaches a stable 1.0 architecture.

## Objective

Keep implementation aligned with well-defined specifications rather than allowing architecture to emerge from incremental feature work.

## Status

Every "Phase 1" spec below has since been written (as a draft, not yet
implemented as real code except where noted) — this doc's own bullets
were originally close paraphrases of each spec's Goals section, which
had drifted into being two unreconciled copies of the same list;
they're one-line pointers now. What's left unwritten: the Ranking
Framework and Memory Model (Phase 2/3), and the plugin-version half of
the Compatibility Matrix (Phase 4, the client/index-version half is
done — see below).

## Phase 1 – Core Specifications

- **Binary Index Format**: written — [spec-binary-format.md](spec-binary-format.md)
  (term/fuzzy/doc-store shard encodings already implemented and shipped
  per that spec's own status note; facet/synonym/pins binary encoding
  remains draft-only).
- **Query Planner**: written — [spec-query-planner.md](spec-query-planner.md)
  (draft, not implemented).
- **Storage Layer**: written — [spec-storage-api.md](spec-storage-api.md)
  (draft, not implemented).

## Phase 2 – Extensibility

- **Plugin API**: written — [spec-plugin-api.md](spec-plugin-api.md),
  alongside the already-*decided* (not just drafted) contract in
  [17-plugin-architecture.md](17-plugin-architecture.md) and the
  core-vs-opt-in boundary in [ADR-0005](adr/0005-plugin-opt-in-boundary.md).
  See spec-plugin-api.md's own header for how the draft and the decided
  contract relate — they're not competing designs.
- **Ranking Framework**: not yet written. Document how multiple ranking
  strategies could coexist while preserving deterministic ordering —
  today there is exactly one (BM25F, [ADR-0003](adr/0003-bm25f-ranking-model.md)),
  so this is genuinely future-looking, not a gap in describing what
  exists.

## Phase 3 – Performance

- **Benchmark Methodology**: written — [spec-benchmarking.md](spec-benchmarking.md)
  (draft methodology; datasets/hardware/warm-cold/reporting format all
  covered there — that spec's Corpus Sizes list is the one authoritative
  copy, not repeated here or in 22/24).
- **Memory Model**: not yet written. Document expected allocation
  strategy, cache ownership, and object lifetime.

## Phase 4 – Operational Features

- **Diagnostics**: written — [spec-diagnostics.md](spec-diagnostics.md)
  (draft, not implemented; explain API, tracing, metrics, profiling
  hooks all covered there).
- **Compatibility Matrix**: partially done. The client-version ↔
  index-version half is real and shipped —
  [02-index-format.md](02-index-format.md#versioning--cache-strategy)'s
  support matrix, enforced by `validateManifest()`, decided in
  [ADR-0004](adr/0004-compatibility-policy.md). A plugin-version axis
  isn't meaningful yet since there's no real plugin *registration*
  mechanism (see Phase 2's Plugin API note above) — nothing to version
  until that exists.

## Success Criteria

The implementation should always follow an approved specification. Significant architectural work should begin with documentation and design before code changes are introduced.