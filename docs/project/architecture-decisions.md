# Architecture decisions

This page indexes the six accepted architecture decision records and summarizes the durable decision made by each.

- [ADR-0001: Pull-based static HTTP transport](../adr/0001-pull-based-static-http.md) — the index is built offline and the browser fetches immutable static files without a query-time backend.
- [ADR-0002: JSON-first index format](../adr/0002-json-first-index-format.md) — JSON is the only index encoding; the binary shard tier this ADR once allowed opting into was removed in Searchable 2.0.
- [ADR-0003: BM25F ranking](../adr/0003-bm25f-ranking-model.md) — BM25F with field, term, and document boosts is the implemented lexical ranking model.
- [ADR-0004: Independent compatibility versions](../adr/0004-compatibility-policy.md) — package APIs use semver while the manifest uses a separately validated integer format version.
- [ADR-0005: Opt-in feature boundary](../adr/0005-plugin-opt-in-boundary.md) — small features remain bundled but data-gated; materially heavy dependencies require an explicit product boundary.
- [ADR-0006: Geo facets and stored-field exact match](../adr/0006-geo-facets-and-stored-field-exact-match.md) — geo radius/distance behavior and exact matching on stored fields are part of the current facet/filter surface.

ADRs record accepted decisions, not every implementation detail. Archived draft designs do not become commitments merely because they exist; current work is tracked only in the [roadmap](roadmap.md).
