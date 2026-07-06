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

**Status**: Prefix matching, distance-1 SymSpell fuzzy dictionaries
(built by default), opt-in distance-2 dictionaries, a length-dependent
maxEdits cap, and "did you mean" are all built and tested — see
[09-roadmap.md](09-roadmap.md#status). The originally-planned
CJK-specific mechanism — bigram-indexed languages getting fuzzy
tolerance "for free" via partial bigram overlap, as an alternative to
edit distance — remains design-only; what's built instead is narrower:
the length cap (below) happens to restrict CJK bigram terms
(docs/03-tokenization-i18n.md#segmentation, always 1-2 characters) to
ordinary distance-1 edit-distance fuzzy matching, not a different
overlap-based mechanism. Building genuine overlap-based relevance for
bigram languages would mean relaxing `search()`'s boolean-AND-across-terms
matching to a minimum-overlap-ratio scheme — a separate, larger,
not-yet-attempted change to the query engine itself, not a fuzzy-plugin
feature.

- **Prefix matching** (`term*`, and implicitly for the last token of an
  in-progress instant-search query) is resolved directly against the
  sorted term dictionary in a shard — since terms are already sorted for
  the binary tier (and shardable by prefix for the JSON tier), a prefix
  query is a contiguous range scan, not a linear scan.
- **Fuzzy/typo-tolerant matching** uses a **SymSpell-style precomputed
  deletion dictionary** built at index time: for each indexed term,
  store its deletion variants (`packages/indexer/src/build-index.ts`'s
  `generateDeletes()`) mapping back to the real term. `buildIndex(sources,
  lang, { fuzzy: true })` builds distance-1 coverage by default;
  `fuzzyMaxEdits: 2` additionally generates every deletion-of-a-deletion
  variant, guaranteeing real distance-2 coverage (not just the
  distance-1 dictionary's occasional distance-2 hits via
  symmetric-delete coincidences, e.g. an adjacent-character
  transposition). Guaranteeing distance-2 matches requires the *query*
  side to generate deletions exactly as deep as the dictionary was
  built — `packages/client/src/search.ts` reads `FuzzyShard.maxEdits`
  back off the fetched shard rather than assuming depth-1, since a
  substitution-type (as opposed to pure-deletion) distance-2 pair only
  meets in the middle if both sides reach the same depth. This turns
  fuzzy lookup into an O(1)-ish dictionary hit instead of computing edit
  distance against every term in a shard, which matters because fuzzy is
  the expensive feature and needs to stay fast enough for instant-search.
  Off by default (`fuzzy: false`) since it adds index size (the
  deletion-variant table, roughly doubling or more at `fuzzyMaxEdits: 2`)
  that not every deployment wants to pay for.
- **Length-dependent maxEdits cap**: regardless of what a dictionary
  was built to support, a query term of 3 code points or fewer is
  capped at accepting only distance-1 matches for actual query
  expansion (`effectiveMaxEdits()` in `packages/client/src/search.ts`)
  — a short term is too close to *everything* for a distance-2 match to
  mean anything (almost any other 3-character term is within 2 edits of
  it). "Did you mean" suggestions deliberately ignore this cap (and the
  dictionary's own maxEdits cutoff) — a term that already failed strict
  fuzzy matching is a suggestion candidate precisely because it's
  further away, so cutting off *suggestions* at the same threshold that
  already rejected it as a match would be self-defeating.
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
5. Check for a matching curated pin
   ([16-term-to-page-pinning.md](16-term-to-page-pinning.md)) and, if
   present (and not excluded by an active filter), insert it at the
   top — a deterministic placement step *after* scoring/sorting, not a
   scoring adjustment, since a pin is a stronger guarantee ("this page
   appears") than a boost ("this page scores higher").
6. Take top-N, fetch doc-store data for those ids only, generate
   highlights, return.
