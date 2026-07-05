# Synonyms

**Status**: Query-time expansion of single-word equivalence classes and
directional maps is built — author-supplied synonym data (there's no
`csf-*` meta tag for this; see ["Authoring workflow"](#authoring-workflow)),
a `synonyms/<lang>.json` shard, and `search(query, {synonyms: true})`
expanding each non-prefix query term into its variants at a reduced
score weight (default 0.5×, overridable) — see
[09-roadmap.md](09-roadmap.md#status). `multiWord` phrase-level
synonyms, index-time expansion, and the `csf synonyms suggest`
authoring tool remain design-only.

## Goals

Let "sofa" find documents containing only "couch", let "js" find
"javascript", let regional spelling variants ("colour"/"color") match
each other — without requiring a reindex every time the synonym list
changes, and without exploding index size.

## Expansion strategy: query-time, not index-time

Two classic approaches exist:

- **Index-time expansion**: at build time, also index each synonym
  variant against the same postings. Pro: no query-time cost. Con: index
  size grows with synonym-set size × occurrence count, and — critically
  for this project — **changing the synonym list requires a full
  reindex**, which conflicts with the "static, rebuilt-offline" model
  being something you don't want to trigger just to tweak a synonym.
- **Query-time expansion** (chosen default): the query is expanded into
  an OR of its synonym variants before hitting the term dictionary
  (`"sofa"` query becomes `sofa OR couch`, each variant contributing to
  scoring as a `should` clause). Pro: synonym file can be updated
  independently of the main index (it's its own small versioned shard,
  [02-index-format.md](02-index-format.md#directory-layout)); zero index
  bloat. Con: slightly more query-time work (a couple extra shard
  fetches for the synonym terms) — an acceptable tradeoff since it's
  bounded and cacheable, not proportional to corpus size.

Index-time expansion remains available as an opt-in for cases where a
synonym set is large and stable and the extra query-time fetch is
undesirable (e.g. very latency-sensitive instant-search); it's a build
flag, not a different architecture.

## Synonym file format

Per language, a simple set-based format (equivalence classes) plus an
optional directional map for one-way expansions:

```jsonc
// synonyms/en.44bb.json
{
  "equivalences": [
    ["sofa", "couch", "settee"],
    ["js", "javascript"],
    ["color", "colour"]
  ],
  "directional": {
    // "laptop" query also matches "notebook" docs, but not vice versa
    "laptop": ["notebook"]
  },
  "multiWord": [
    // phrase-level synonyms, matched against the un-stemmed phrase
    ["new york", "nyc", "big apple"]
  ]
}
```

- **Equivalence classes**: any term in the set expands the query to all
  others in the set (symmetric).
- **Directional**: expands only in the listed direction — useful for
  "broader term also matches narrower term" cases where the reverse
  would be too aggressive (querying "notebook" shouldn't necessarily
  surface every generic "laptop" doc).
- **Multi-word/phrase synonyms**: matched before tokenization/stemming
  splits them apart, since "new york" and "nyc" don't share a stem.

Synonyms are applied **after** stemming for single-word entries (so the
synonym file can be authored with stems or surface forms; the loader
stems entries at load time using the same language profile) and applied
as a phrase-level rewrite pass before tokenization for multi-word
entries.

## Per-language synonym sets

Synonyms are inherently language-specific (a manifest maps
`language → synonym shard`, same pattern as term shards). There's no
cross-language synonym expansion by default (translation is a much
harder, different problem — out of scope, see
[00-overview.md](00-overview.md#non-goals)), though nothing prevents an
author from manually adding cross-language entries to a given language's
file if they want e.g. brand names to match regardless of query language.

## Authoring workflow

- Hand-authored YAML/JSON source (readable, diffable, PR-reviewable) is
  compiled by the indexer into the shard format above — the source
  format supports comments and grouping; the shard format is the
  minimal runtime-consumable shape.
- A `csf synonyms suggest` indexer subcommand (future/roadmap item) can
  mine co-occurrence statistics or use an embedding-based nearest-neighbor
  pass over the corpus vocabulary to *propose* candidate synonym pairs for
  a human to accept/reject — synonym lists are never auto-applied without
  review, since bad synonyms actively hurt relevance.

## Scoring impact

Synonym-expanded terms contribute to BM25F scoring like any `should`
clause, but at a **reduced weight** (configurable, default 0.5×) relative
to a literal query-term match, so a document that actually contains the
literal query term still outranks one that only matches via synonym
expansion, all else equal.

## Interaction with fuzzy matching

Synonym expansion and fuzzy matching are independent, ordered passes:
query terms are first checked against the synonym table (exact lookup),
*then* whatever terms remain (or all expanded variants) are eligible for
fuzzy matching if enabled. This avoids fuzzy-matching accidentally
"discovering" a synonym relationship by coincidence of edit distance
(e.g. "cat"/"car") and mislabeling it as intentional.
