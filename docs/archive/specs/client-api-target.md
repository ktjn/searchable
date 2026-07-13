# Archived target client API

This archive preserves the unimplemented target-only portion of the former client API design. It is historical material, not the `@ktjn/searchable-client` contract; current exports are documented in [`../../reference/client-api.md`](../../reference/client-api.md).

## Extended search options

The former target proposed richer match-mode controls, per-field query clauses, timeouts, soft failure, and diagnostic output beyond the implemented `SearchOptions`.

## Warm-up and preload

The target proposed `preload` hints and a `warmup()` method for manifest, common-shard, or feature prefetching.

## Suggestions and autocomplete

The target proposed a separate suggestions API with configurable limits and fuzzy behavior.

## Federated search

The target proposed combining multiple independently hosted indexes through one client surface.

## Partial failure

The target proposed returning incomplete results with structured shard errors instead of rejecting selected failures.

These proposals require a concrete consumer and belong in the [roadmap](../../project/roadmap.md) before implementation.
