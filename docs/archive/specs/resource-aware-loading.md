# Archived resource-aware loading proposals

This archive preserves target-only loading policies from the former resource-aware loading design. Current lazy and offline behavior is documented in [`../../guides/offline-search.md`](../../guides/offline-search.md).

## Network-aware priority

The proposal classified manifest, active term shards, likely next-prefix shards, and optional feature data into browser fetch-priority tiers.

## Data-saver and connection adaptation

The proposal reduced speculative prefetching under `saveData` or constrained effective connection types.

## Memory budgets

The proposal introduced approximate cache budgets, least-recently-used eviction, and device-memory-informed defaults.

## CPU scheduling

The proposal time-sliced long worker operations and used transferable buffers for larger binary payloads.

These policies are not implemented contracts. Any revival needs measured browser evidence and is tracked through the [roadmap](../../project/roadmap.md).
