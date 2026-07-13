# Pinning

This guide explains how content authors place selected pages above organic results for specific normalized queries.

## Authoring

Add one or more `searchable-pin` meta tags to a page. The optional `searchable-pin-mode` is `exact` by default or `contains`; `searchable-pin-priority` is numeric and defaults to `0`; the presence of `searchable-pin-exclusive` suppresses organic results for a matching pin.

```html
<meta name="searchable-pin" content="pricing">
<meta name="searchable-pin-mode" content="contains">
<meta name="searchable-pin-priority" content="10">
```

## What happens at query time

Pins are analyzed per page language and emitted in language-specific JSON shards. At query time the client orders matching pins by priority, then document boost, then deterministic build order. An active facet filter can exclude a pinned page. Non-exclusive pins are deduplicated from organic results and keep `hit.pinned: true`; exclusive pins become the whole result set.

## Conflicting pins

Multiple pages may pin the same phrase. Higher priority wins, followed by document boost and deterministic build order; the indexer emits a warning for the conflict.

Pins are not wildcards, regular expressions, or a ranking boost. Use [Ranking and boosts](ranking-and-boosts.md) for relevance tuning.
