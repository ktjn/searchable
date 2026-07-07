# Modern Client-side Search Features

This document captures features worth considering beyond the current implementation.

## Query capabilities

- Boolean queries (OR, NOT, required terms)
- Field-scoped queries (`title:`, `tag:`)
- Phrase boosting independent of phrase filtering
- Proximity/slop queries
- Autocomplete/typeahead
- Spell correction with query rewrite
- Result diversification

## Ranking

- Explain API
- Learning-to-rank hook
- Freshness decay
- Authority/page importance
- Near-duplicate detection

## User experience

- Passage/snippet generation
- Grouped results
- Federated search across multiple indexes
- Analytics hooks (query, click, abandon, zero-result)

## Indexing

- Incremental index patches
- Crawlers and CMS adapters
- Schema validation CLI
- Synonym tooling
- Language fallback

## Performance

- Query planner
- Top-K heap
- Intelligent shard prefetching
- IndexedDB storage backend
- WASM acceleration for hot paths

## Security

- Strict URL policy
- CSP guidance
- Resource budgets (bytes, shards, fuzzy expansion, time)

## Recommended priorities

1. Explain API
2. Query planner
3. Autocomplete
4. Boolean query grammar
5. Snippet generation
6. Incremental index updates
7. Analytics hooks
8. Federated search
9. Resource/security policies
10. IndexedDB storage backend