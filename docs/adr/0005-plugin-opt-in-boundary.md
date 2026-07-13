# ADR-0005: What's core (always bundled) vs. opt-in (separately gated)

## Status

Accepted for the boundary as it exists today. The full dynamic plugin
*registration* system in [archive/specs/plugin-architecture.md](../archive/specs/plugin-architecture.md) /
[archive/specs/plugin-api.md](../archive/specs/plugin-api.md) remains a draft spec, not
built — this ADR is about the boundary decision already made and
shipped, not the future registration mechanism.

## Context

[The overview](../getting-started/overview.md)'s small-core goal and the 15 KB
gzip bundle budget ([Project governance](../project/governance.md#performance-policy))
require a decision about which features every consumer pays for versus
which are opt-in. Two genuinely different mechanisms exist in this
codebase for "opt-in" and conflating them would misdescribe the system.

## Decision

Two distinct opt-in mechanisms, chosen per feature by its actual cost
shape, not one uniform plugin system:

1. **Baked-in-but-inert-until-used** (facets, synonyms, pins, fuzzy
   matching): shipped in the one `@ktjn/searchable-client` bundle unconditionally —
   `pnpm size`'s 15 KB budget is measured against this bundle including
   all of them.
   These stay small enough in code size that separate bundle-splitting
   isn't worth the complexity yet; the *data* for each (a synonym shard,
   a fuzzy shard) is still fetched lazily only when a query needs it, so
   the runtime cost is opt-in even though the code isn't.
2. **Genuinely separate, lazy-loaded dependency**
   (`@huggingface/transformers`-backed embedding): the
   transformers integration is a `devDependency` + optional
   `peerDependency`, loaded via a lazy `import()` and listed in
   `rollupOptions.external`
   ([Project governance](../project/governance.md#performance-policy)) —
   it costs zero bytes against the core budget unless a consumer
   actually calls `createTransformersEmbedQuery()`. This is the pattern
   for anything with real weight (a multi-MB model, a codec only some
   deployments need).

A real dynamic plugin *registration* API (third-party analyzers/ranking/
storage backends registering themselves, per
[archive/specs/plugin-architecture.md](../archive/specs/plugin-architecture.md)'s contract) is
explicitly not required for 1.0 — see
the [roadmap](../project/roadmap.md).

## Alternatives Considered

- **A uniform plugin-registration system now, for every feature
  including facets/synonyms/fuzzy**: rejected for 1.0 — these are a few
  KB total, well under budget; building a registration/capability-
  negotiation mechanism (the archived plugin architecture's full contract) for
  features that cost nothing today is complexity with no present payoff,
  the same "don't design for hypothetical future requirements" tradeoff
  the project's own contributor guidelines call for.
- **Bundling `@huggingface/transformers` unconditionally**: rejected
  outright — it would blow the 15 KB core budget by orders of magnitude
  for every consumer, including the majority who never touch vector
  search.

## Consequences

- Binary shard data is opt-in, but its small decoder code remains part of
  the client search bundle; `pnpm size` checks that combined reality.
- Adding a genuinely large future feature (e.g. a WASM scoring core)
  should default to mechanism 2 (lazy-loaded, external, opt-in
  dependency) rather than mechanism 1, following the precedent
  transformers integration already set.
