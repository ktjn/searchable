# Ranking and boosts

This guide explains the implemented lexical query syntax and the layers that affect BM25F ranking.

## Query input forms

Plain words are analyzed and combined as required query clauses. Append `*` for a prefix clause and use double quotes for a phrase whose analyzed terms must occur at adjacent positions.

## Ranking model: BM25F

BM25F combines term frequency across fields before saturation. The indexer defaults to a title boost of `3.0` and body boost of `1.0`; `BuildIndexOptions.fieldBoosts` overrides those values. At query time, `SearchOptions.boosts.fields` overrides field weights and `SearchOptions.boosts.terms` multiplies a normalized term's contribution. A page's `searchable-boost` value is applied as a document multiplier.

## Boost types, summarized

Build-time field boosts establish corpus defaults, query field/term boosts tune one search, and `searchable-boost` applies to every query that matches the document.

## Prefix and fuzzy matching

Enable typo tolerance with `fuzzy: true`. The index must have been built with `BuildIndexOptions.fuzzy`; `fuzzyMaxEdits` selects a deletion dictionary depth of `1` or `2`, and `fuzzyWeight` controls the penalty for non-literal matches. A zero-result fuzzy query can return `didYouMean` terms.

Prefix expansion is shard-aware and does not require scanning the full corpus.

```ts
const result = await search.search("installtion guide*", {
  boosts: { fields: { title: 4 }, terms: { guide: 1.5 } },
  fuzzy: true,
  fuzzyWeight: 0.7,
});
```

## Phrase and proximity queries

Quoted phrases require their analyzed terms at consecutive positions in the same field. Broader proximity syntax is not implemented.

## Did you mean and query suggestions

When fuzzy matching is enabled and still returns no hits, `SearchResult.didYouMean` can contain nearest real corpus terms.

Pins remain editorial ordering rather than relevance scoring. See [Pinning](pinning.md).
