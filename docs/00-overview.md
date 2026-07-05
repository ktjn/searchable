# Overview

## Problem statement

Provide search-as-a-service *quality* (relevance ranking, facets, typo
tolerance, multi-language) without a search *service* — no query-time
backend, no hosted API, no per-query billing. The index is built offline
and published as static files; all query execution happens in the
requester's browser.

This trades a small amount of client CPU/bandwidth for zero
infrastructure, zero query latency to a third party, and full data
locality (useful for docs sites, catalogs, internal tools, offline-first
apps, and privacy-sensitive search).

## Goals

1. **Static-hostable index.** The entire index is a set of immutable,
   content-hashed files servable by any HTTP static host (S3, GitHub
   Pages, Netlify, nginx). No server-side code required at query time.
2. **Scales past "toy" corpora.** Sharding + lazy fetch so a 200k-document
   index doesn't require downloading megabytes of JSON before the first
   keystroke.
3. **Relevance parity with server engines.** BM25F-style scoring, field
   boosts, document boosts, phrase/prefix/fuzzy matching, synonym
   expansion, "did you mean".
4. **First-class faceted search.** Multi-select facets, numeric ranges,
   hierarchical facets, live facet counts.
5. **First-class internationalization.** Per-language tokenization,
   stemming, stopwords, CJK/Thai segmentation, correct Unicode handling,
   mixed-language corpora and mixed-language queries.
6. **Modern DX and UX.** TypeScript API, tree-shakeable plugins, Web
   Worker execution, streaming/incremental results, cancellable requests,
   highlighting, accessibility, offline/PWA support.
7. **Small core.** Base runtime stays in the low tens of KB; every
   optional capability (a given language's stemmer, fuzzy matching,
   synonyms UI helpers) is an opt-in plugin.

## Non-goals

- **Not a general document database.** No updates/deletes at query time;
  the index is rebuilt offline and republished. (A future "incremental
  patch" mechanism is a stretch goal, see roadmap.)
- **Not a replacement for server-side search at extreme scale**
  (tens of millions of documents, sub-10ms p99 at high QPS, complex
  personalization/ML ranking). Past a certain corpus size, a hosted
  engine is the right tool — this project should say so rather than
  pretend otherwise.
- **Not a crawler/CMS connector framework**, though the indexer should
  expose clean ingestion hooks so one can be built on top.
- **Not doing server-side rendering of search results.** This is a client
  runtime; SSR/SSG integration is a consumer concern (though the API
  should not preclude it — see [07-client-api.md](07-client-api.md)).

## Guiding principles

- **Static + pull, never dynamic + push.** If a feature needs the server
  to compute something per-query, it doesn't belong in the core design;
  push that computation to the client or to index-build time.
- **Pay only for what you use.** Bundle size and fetched bytes should
  scale with corpus size and query complexity, not with the total set of
  features the library supports.
- **Progressive enhancement of relevance.** Cheap/approximate signals
  first (exact term match), refined signals layered on (boosts, fuzzy,
  synonyms) — never block first results on the most expensive step.
- **Correctness per language, not lowest-common-denominator English.**
  Tokenization, stemming, and relevance defaults should be language-aware
  from day one, not bolted on later.
- **The index format is a spec, not a library.** It's plain, documented
  JSON that any server-side language can emit with basic tooling
  (Python/Node/Java, or anything else with a JSON encoder) — the
  reference indexer is one valid producer, not the only one. See
  [02-index-format.md](02-index-format.md#the-format-is-a-spec-not-a-library-dependency).
- **Simple over clever, without giving up power.** Prefer the plainest
  data structure and algorithm that meets the relevance/perf bar (a
  sorted array over a bespoke tree, a documented formula over an
  opaque heuristic). Power features (boosts, synonyms, fuzzy, facets,
  i18n) are additive layers on a simple core, not woven through it —
  each should be understandable, testable, and removable independently.
  Every design decision here should be checked against "does this
  actually need to be this complicated?" before being adopted.
- **Untested is unfinished.** Every feature in this design ships with
  correctness tests (does it return the right results) and, where
  relevant, performance tests (does it stay fast as corpus/query
  complexity grows) — see
  [10-testing-and-performance.md](10-testing-and-performance.md).
- **Modular by contract, not by convention.** Every optional capability
  (fuzzy, synonyms, facets, pins, i18n stemmers, vector search) attaches
  to a documented hook in core rather than core knowing it exists — see
  [17-plugin-architecture.md](17-plugin-architecture.md). This is what
  actually delivers "pay only for what you use": a naming convention
  alone doesn't stop core from importing a feature it merely doesn't
  enable.
- **A good browser citizen, not just a fast one.** The engine must never
  be the reason the *host page* feels slow — network requests it makes
  speculatively yield priority to the page's own critical resources,
  memory/CPU usage adapts to the device, and cancellation is honored
  promptly even inside a background thread. See
  [18-resource-aware-loading.md](18-resource-aware-loading.md).
