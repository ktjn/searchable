# Term-to-Page Pinning ("Best Bets")

**Status**: Built — extraction of `csf-pin`/`csf-pin-mode`/
`csf-pin-priority`/`csf-pin-exclusive`, the pins shard format, exact and
contains matching, priority/boost/build-order conflict resolution (with
the build warning below), exclusivity, and the facet-filter interaction
all have working code and real tests in
[`packages/indexer`](../packages/indexer)/[`packages/client`](../packages/client) —
see [09-roadmap.md](09-roadmap.md#status).

Lets a CMS author guarantee that searching a specific word or phrase
surfaces a specific page — e.g. searching "pricing" always shows the
`/pricing` page first, regardless of what the general ranking model
would have scored it. This is a standard capability in mature search
products (Algolia calls it "Rules," Elasticsearch/Coveo call it
"curations"/"featured results," older enterprise search called it "best
bets") — this doc adapts the idea to this project's constraints: fully
static, authored via the meta-tag control surface in
[15-cms-meta-tag-control.md](15-cms-meta-tag-control.md), no query-time
backend.

## Authoring

Declared **on the target page**, not in a separate curation file (same
reasoning as [15-cms-meta-tag-control.md](15-cms-meta-tag-control.md#why-not-a-separate-config-file) —
the pin lives with the content it promotes):

```html
<meta name="csf-pin" content="pricing">
<meta name="csf-pin" content="how much does it cost">
```

- `csf-pin` is repeatable — a page can pin multiple terms/phrases.
- Matching runs through the **same per-language analysis pipeline** as
  normal query processing (tokenize, stem, fold, stopword-strip per
  [03-tokenization-i18n.md](03-tokenization-i18n.md#pipeline-stages)) —
  the pin term isn't matched as a literal string. This means a pin on
  "pricing" also matches "price" or "prices" if they stem to the same
  root, which is the expected, useful behavior, not an edge case to
  special-case around.
- **Default match mode is `exact`**: the *entire* normalized query must
  equal the normalized pin phrase. This is deliberately strict —
  classic best-bets semantics are "this specific search redirects to
  this page," and a loose default would surprise authors by pinning
  pages for queries that merely happen to contain a common word.
- **`contains` mode** (`<meta name="csf-pin-mode" content="contains">`)
  relaxes this to "the query contains this phrase as a subsequence,"
  useful for a broader promotional rule (e.g. pin the pricing page for
  any query containing "cost") — opt-in, and worth a build-time note
  reminding the author that broader match modes are easier to get
  unexpected results from, precisely because they're broader.

## What happens at query time

1. The query is normalized through the standard analysis pipeline
   (same as any query,
   [04-query-ranking-boosts.md](04-query-ranking-boosts.md)).
2. The normalized query is looked up in a small **pins shard**
   (fetched alongside — and about as cheap as — the synonym shard,
   [05-synonyms.md](05-synonyms.md)) keyed by normalized pin phrase.
3. On a hit, the pinned page(s) are inserted at the top of the result
   list, marked `pinned: true` in the returned `Hit` so the UI can style
   them distinctly (e.g. a "Featured" badge) from organically-ranked
   results — this is a deliberate, visible authorial decision, not
   something that should look like the algorithm "just happened" to
   rank it first.
4. Unless `csf-pin-exclusive` is set, the normal query still runs and
   its results are appended below the pinned result(s) (with the pinned
   doc's id excluded from the organic list if it would have appeared
   there too, to avoid showing it twice). If `csf-pin-exclusive` is set,
   the organic query is skipped entirely for that exact query — useful
   for narrow, intentional redirects (e.g. a specific part number that
   should only ever show one page).
5. **Interaction with active facet filters**: if the caller has an
   active filter that excludes the pinned page (e.g. filtered to a
   category the pinned page isn't in), the pin is **not** shown — an
   explicit user filter takes precedence over an author's pin, since
   showing a result that contradicts a filter the user deliberately set
   would be a worse experience than a strictly-correct filtered list.
   Pins only apply to the unfiltered/default view of a matching query.

Pins are a **result-list-shaping step, not a scoring adjustment** —
unlike a document boost ([04-query-ranking-boosts.md](04-query-ranking-boosts.md#boost-types-summarized)),
which nudges BM25F scores, a pin is a deterministic placement decision
applied after scoring, precisely because "guarantee this page appears
for this query" is a different (and stronger) guarantee than "make this
page score higher."

## Storage format

Same shard-per-language pattern as everything else:

```jsonc
// pins/en.7ab3.json
{
  "pricing": {
    "mode": "exact",
    "docs": [{ "id": 41, "priority": 10, "exclusive": false }]
  },
  "how much does it cost": {
    "mode": "exact",
    "docs": [{ "id": 41, "priority": 0, "exclusive": false }]
  }
}
```

Small enough (typically a handful to a few hundred entries even for a
large site) that it's fetched in full alongside the manifest rather than
sharded further — pins are a curated, human-authored set, not something
that scales with corpus size the way term postings do.

## Conflicting pins

Two different pages can legitimately pin the same term (a build-time
situation the indexer must handle, not silently resolve one way):

- The indexer **always emits a build warning** listing every term with
  more than one pinning page, since this is very likely either a
  genuine editorial decision (show both) or an oversight (only one was
  intended) — surfacing it lets a human decide, rather than the tooling
  guessing silently.
- **Resolution order**: explicit `csf-pin-priority` (higher wins) first;
  if still tied, the page's document boost
  ([04-query-ranking-boosts.md](04-query-ranking-boosts.md#boost-types-summarized))
  breaks the tie; if still tied, build order (stable, but arbitrary —
  the warning is what actually matters here, not the tie-break rule).
- **Multiple pins for one term are not an error** — all matching pages
  are inserted in priority order, so "show these two pages for this
  query" is a supported, first-class outcome, not merely a
  fallback-from-conflict behavior.

## API surface

```ts
const result = await client.search("pricing");
result.hits[0]; // { id: 41, pinned: true, ...normal Hit fields }
```

No separate method — pins are transparent to `search()`/`searchStream()`
callers; the only visible surface is the `pinned` flag on affected hits,
so existing result-rendering code needs at most a one-line addition (a
"Featured" badge) to take advantage of it, not a new integration.

## Non-goals

- Not a general redirect mechanism (no HTTP redirect, no URL rewriting)
  — it only affects what the search UI displays for a given query, not
  browser navigation.
- Not query-pattern matching (no wildcards/regex in `csf-pin` content) —
  deliberately limited to exact-normalized-query or whole-query-contains
  matching, keeping the mental model ("this exact search, this exact
  page") simple and auditable from the build-time pin report, rather
  than opening up a small rules-engine surface that would need its own
  testing story.
