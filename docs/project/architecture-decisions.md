# Architecture decisions

This page indexes the five accepted architecture decision records and summarizes the durable decision made by each.

- [ADR-0001: Pull-based static HTTP transport](../adr/0001-pull-based-static-http.md) — the index is built offline and the browser fetches immutable static files without a query-time backend.
- [ADR-0002: JSON-first index format](../adr/0002-json-first-index-format.md) — JSON is universal while measured hot shard families can opt into an independent binary encoding.
- [ADR-0003: BM25F ranking](../adr/0003-bm25f-ranking-model.md) — BM25F with field, term, and document boosts is the implemented lexical ranking model.
- [ADR-0004: Independent compatibility versions](../adr/0004-compatibility-policy.md) — package APIs use semver while the manifest uses a separately validated integer format version.
- [ADR-0005: Opt-in feature boundary](../adr/0005-plugin-opt-in-boundary.md) — small features remain bundled but data-gated, while materially heavy dependencies are separately and lazily loaded.

ADRs record accepted decisions, not every implementation detail. Proposed query-planner, storage, diagnostics, and plugin designs remain archived until a concrete consumer justifies revisiting them; see the [roadmap](roadmap.md).
