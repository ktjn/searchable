# Synonyms

This guide describes authored query-time synonym expansion and its scoring behavior.

## Synonym file format

Synonyms are supplied to `buildIndex` by language, not through page metadata. The indexer normalizes them with the same language profile used for documents and writes a language-specific shard.

```ts
const built = buildIndex(documents, "en", {
  synonyms: {
    en: {
      equivalences: [["laptop", "notebook"]],
      directional: { tv: ["television"] },
      multiWord: [["new york", "nyc", "big apple"]],
    },
  },
});
```

## Scoring impact

Set `synonyms: true` per query. `synonymWeight` penalizes an expanded match so a literal match wins when the remaining score is equal. Equivalence groups expand in every direction; directional entries expand only from the key. Multi-word groups participate in quoted phrase matching with real positional adjacency.

Prefix clauses are not synonym-expanded. Synonym data is fetched only when enabled and when the resolved language has a synonym shard.
