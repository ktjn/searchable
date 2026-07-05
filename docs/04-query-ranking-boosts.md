# Query Language, Ranking & Boosts

## Query input forms

Two levels are supported so simple integrations stay simple:

1. **Plain string** (typical search box input): `wireless keyboard -bluetooth "exact phrase"`
   - space-separated terms are ANDed by default (configurable to OR),
   - `-term` excludes,
   - `"quoted phrase"` requires adjacency,
   - `term*` prefix/wildcard match (for autocomplete-style typing),
   - `field:term` restricts a term to one field (e.g. `title:widget`).
2. **Structured query object** (programmatic / advanced UI), which the
   string form is parsed into:

```ts
interface Query {
  must?: Clause[];       // AND
  should?: Clause[];     // OR, contributes to score
  mustNot?: Clause[];    // exclusion
  filters?: Filter[];    // facet/range filters, non-scoring
  language?: string;
  boosts?: {
    fields?: Record<string, number>;   // per-query field boost override
    terms?: Record<string, number>;    // per-query term boost, e.g. {"widget": 2}
  };
  fuzzy?: boolean | { maxEdits: number };
  synonyms?: boolean;
}

type Clause =
  | { type: "term"; value: string; field?: string }
  | { type: "phrase"; values: string[]; field?: string; slop?: number }
  | { type: "prefix"; value: string; field?: string };
```

Keeping both forms means a `<input>`-driven instant-search box and a
faceted-filter UI with an "advanced query" toggle share one engine.

## Ranking model: BM25F

Standard **BM25** (Okapi) extended to multiple weighted fields — **BM25F**
— because documents have structurally different fields (title vs body vs
tags) that should contribute differently to relevance, and because BM25F
combines field-level term frequency *before* the saturation nonlinearity,
which handles field-boost interaction better than scoring each field with
plain BM25 and linearly summing (the naive approach over/under-weights
multi-field matches).

Per-term, per-document score contribution:

```
score(term, doc) = idf(term) * ( tf_weighted / (tf_weighted + k1) )

tf_weighted = Σ_field  boost[field] * tf(term, field, doc) / length_norm(field, doc)

length_norm(field, doc) = (1 - b) + b * (fieldLength(doc, field) / avgFieldLength[field])

idf(term) = ln( 1 + (N - df(term) + 0.5) / (df(term) + 0.5) )
```

- `k1` (term-frequency saturation, default 1.2) and `b` (length
  normalization strength, default 0.75) are standard BM25 knobs, tunable
  per index in the manifest.
- `boost[field]` comes from the manifest's field weights (author-set at
  index-build time, e.g. title=3, tags=1.5, body=1) and can be overridden
  per-query.
- Document-level static boosts (e.g. "boost newer docs", "boost featured
  products") are applied as a final multiplier: `finalScore = Σ score(term, doc) * docBoost(doc)`,
  where `docBoost` is a stored per-document scalar (set at index time
  from e.g. a `boost` field on the source document, defaulting to 1.0) —
  kept as a plain multiplier (not folded into BM25 itself) so it's cheap
  to recompute/override per-query without touching the term-level math
  (e.g. a "boost by recency" toggle in the UI just changes this
  multiplier using a stored `publishedAt`, no reindex needed).

## Boost types, summarized

| Boost | Set where | Applies to |
|---|---|---|
| Field boost | manifest (build time), overridable per-query | weight of a term match depending which field it hit |
| Term boost | per-query only | weight of one specific query term (`^` syntax: `title^2 widget^3`) |
| Document boost | per-document at index time (e.g. from CMS "featured" flag or recency) | flat multiplier on a doc's total score |
| Exact-match boost | manifest, default on | extra multiplier when a whole field value equals the query verbatim (e.g. an exact SKU or exact title match should usually win over a diffuse body match) |

## Prefix & fuzzy matching

- **Prefix matching** (`term*`, and implicitly for the last token of an
  in-progress instant-search query) is resolved directly against the
  sorted term dictionary in a shard — since terms are already sorted for
  the binary tier (and shardable by prefix for the JSON tier), a prefix
  query is a contiguous range scan, not a linear scan.
- **Fuzzy/typo-tolerant matching** (edit distance ≤ 1 or 2, length- and
  language-dependent — e.g. CJK bigram-indexed languages get fuzzy
  matching "for free" via bigram overlap rather than edit distance)
  uses a **SymSpell-style precomputed deletion dictionary** built at
  index time: for each indexed term, store its distance-1 (and
  optionally distance-2) deletion variants mapping back to the real term.
  This turns fuzzy lookup into an O(1)-ish dictionary hit instead of
  computing edit distance against every term in a shard, which matters
  because fuzzy is the expensive feature and needs to stay fast enough
  for instant-search. Shipped as `plugin:fuzzy` since it adds index size
  (the deletion-variant table) that not every deployment wants to pay for.
- Fuzzy results are always ranked below exact/prefix matches for the same
  term (a small score penalty proportional to edit distance) rather than
  mixed in undifferentiated.

## "Did you mean" / query suggestions

When a query returns zero (or below-threshold) results, the fuzzy
dictionary is reused to suggest the nearest real term(s) in the corpus,
surfaced as a "did you mean: *widget*?" affordance — no separate
suggestion index needed, it's a byproduct of the fuzzy plugin.

## Phrase & proximity queries

Postings retain per-field token **positions**
([02-index-format.md](02-index-format.md#term-shard-inverted-index)), so:
- Phrase queries (`"exact phrase"`) require consecutive positions across
  the matched terms in the same field.
- An optional proximity/slop parameter relaxes "consecutive" to "within
  N positions," contributing a proximity boost (closer = higher score)
  rather than a hard requirement — useful for "should" clauses.

## Combining with filters/facets

Filters (from [06-faceted-search.md](06-faceted-search.md)) are
**non-scoring** — they restrict the candidate doc set (via doc-id set
intersection against the facet index) before/alongside scoring, so
faceting never distorts relevance ranking, only narrows it.

## Result assembly

1. Evaluate must/should/mustNot clauses → candidate doc-id set with
   per-term posting data.
2. Apply filters (doc-id set intersection).
3. Score candidates (BM25F + boosts as above).
4. Sort by score (or by an explicit sort field, e.g. price/date, when the
   UI requests it — pure sort bypasses relevance scoring entirely, which
   is a supported mode, not a hack).
5. Take top-N, fetch doc-store data for those ids only, generate
   highlights, return.
