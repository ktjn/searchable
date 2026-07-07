# ADR-0003: BM25F with configurable field/doc/term boosts as the ranking model

## Status

Accepted (implemented since Phase 1/2, `packages/client/src/score.ts`).

## Context

[00-overview.md](../00-overview.md)'s goals call for "relevance parity
with server engines" — a concrete ranking model had to be picked that
supports multi-field documents (title vs. body should not weigh equally),
per-query and per-document tuning, and stays computable client-side
without a corpus-wide index scan per query.

## Decision

BM25F ([04-query-ranking-boosts.md](../04-query-ranking-boosts.md)):
per-field term frequency combined with field weights before the BM25
saturation function is applied, rather than scoring each field with
plain BM25 and summing — the mathematically correct way to combine
multi-field relevance rather than an ad-hoc weighted sum of independent
scores. Layered on top: configurable field boosts (build-time default,
per-query override), a per-query term boost, and a per-document
`csf-boost` multiplier applied last. Corpus-wide statistics
(`docCount`, `avgFieldLength`) are computed *per language*
(Phase 4, [09-roadmap.md](../09-roadmap.md)), since mixing two
languages' statistics into one number would skew idf and length
normalization for both.

## Alternatives Considered

- **Plain per-field BM25 summed with weights**: rejected — double-counts
  term frequency saturation per field instead of combining raw
  frequencies before saturating once, the specific defect BM25F exists
  to fix.
- **TF-IDF without saturation**: rejected — no length normalization or
  diminishing returns on repeated terms, worse relevance behavior on
  real prose than BM25F for no simplicity win (the computation cost
  difference is negligible client-side).
- **A pluggable/swappable ranking function from day one**: deferred, not
  rejected — [24-architecture-recommendations.md](../24-architecture-recommendations.md)
  and [23-implementation-roadmap.md](../23-implementation-roadmap.md)'s
  "Ranking Framework" phase note that supporting multiple coexisting
  ranking strategies with deterministic ordering is real future work,
  but BM25F is the one model implemented and tested today; building a
  swap mechanism for a hypothetical second model isn't justified yet.

## Consequences

- Every ranking-affecting change (boost defaults, `k1`/`b` constants) is
  covered by the configuration-testbed snapshot suite
  (`packages/client/test/config-testbed.test.ts`) so an unintended
  ranking shift shows up as a reviewable diff, the same way a UI
  screenshot test catches an unintended visual change.
- BM25's `k1`/`b` constants are not yet author-configurable
  (09-roadmap.md's testbed note) — a fixed choice for 1.0, revisit only
  with a concrete deployment that needs to tune them.
- Freshness/authority-based ranking (time decay, link-count authority)
  stays out of scope for 1.0 — [09-roadmap.md](../09-roadmap.md)'s Open
  Questions leaves it for a deployment with a concrete staleness problem
  to drive the design, rather than guessing a decay curve with no data.
