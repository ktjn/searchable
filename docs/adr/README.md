# Architecture Decision Records

[22-project-governance.md](../22-project-governance.md) calls for ADRs
under this directory for index format changes, ranking model changes,
storage abstractions, compatibility policy, and plugin APIs — but none
existed until the [1.0 release plan](../25-path-to-1.0.md) asked for
them. These five are written retroactively, from decisions already made
and already justified at length in the design docs each one cites: the
point of writing them now, before 1.0 freezes the public API, is a
permanent dated record of *why*, not a design exercise — nothing here
changes behavior.

Template (per 22-project-governance.md):

- Title
- Status
- Context
- Decision
- Alternatives Considered
- Consequences

| ADR | Decision |
|---|---|
| [0001](0001-pull-based-static-http.md) | Pull-based static HTTP transport, no query-time backend |
| [0002](0002-json-first-index-format.md) | JSON-first index format; binary tier is an opt-in per-shard encoding, not a format switch |
| [0003](0003-bm25f-ranking-model.md) | BM25F with configurable field/doc/term boosts as the ranking model |
| [0004](0004-compatibility-policy.md) | Semver for the public API; a manifest `version` integer for the index format, checked independently |
| [0005](0005-plugin-opt-in-boundary.md) | What's core (always bundled) vs. opt-in (a separate capability gated by its own bundle cost) |

New ADRs after 1.0 should be numbered `000N` sequentially and added to
this table.
