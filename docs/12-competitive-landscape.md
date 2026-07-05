# Competitive Landscape & Features to Cherry-Pick

A survey of the closest existing prior art, done to (a) sanity-check this
design against what's already shipped and working in the wild, and (b)
deliberately borrow good ideas rather than reinvent them. Where a source
below couldn't be fully confirmed from public docs at research time,
it's flagged `unclear` rather than asserted — worth re-verifying before
leaning on it for a decision.

## Comparison table

| | **This design** | Orama | MiniSearch | Lunr.js | FlexSearch | Pagefind |
|---|---|---|---|---|---|---|
| Index delivery | Sharded, lazy **HTTP fetch** per query | Whole index **in-memory** at runtime | Whole index **in-memory** | Whole index **in-memory** | In-memory (optional persistent adapters: IndexedDB/Redis/SQL) | Sharded, lazy **HTTP fetch** per query (closest match) |
| Ranking | BM25F (multi-field) | BM25 (tunable k1/b/d) | TF-IDF / BM25 | TF-IDF / vector-space | Custom contextual/proximity scoring | Weight-based, qualitative (not confirmed as BM25) |
| Field/doc boosts | Yes (field, term, doc) | Yes (field) | Yes (field) | Yes (query-time term boost, index-time doc boost) | Yes (field/tag weighting) | Yes (`data-*` attribute weighting) |
| Synonyms | Yes, query-time expansion | `unclear` | Not built-in | Not built-in | `unclear` | Not built-in |
| Facets | Yes (terms/range/hierarchy, contextual counts) | Yes, built-in | Not built-in (DIY) | Not built-in (DIY) | Yes, via tag-based multi-tag search | Yes, `data-pagefind-filter` |
| Fuzzy/typo tolerance | Yes (SymSpell-style) | Yes (Levenshtein) | Yes (edit distance) | Yes (edit distance + wildcards) | Yes (tolerant/phonetic encoders) | No true fuzzy — stemming only, no typo correction |
| Prefix/autocomplete | Yes | `unclear` | Yes, built-in | Yes, via wildcards | Yes (forward/reverse tokenizers) | Yes |
| Multi-language | Per-language profiles, `Intl.Segmenter`, CJK bigram fallback | ~30 languages claimed | None by default (pluggable/DIY) | English core + `lunr-languages` plugin (30+) | Dedicated CJK/Arabic/Hebrew/Cyrillic encoders | Automatic per-`lang` stemming; CJK segmentation in "extended" build only |
| Runtime | Browser (query) + any language (index build) | Isomorphic (browser/Node/edge) | Isomorphic | Browser + Node | Isomorphic, dedicated Worker index class | Offline Node/Rust build, browser+WASM query |
| Index format openness | **Open, documented, language-agnostic JSON spec** | Proprietary, library-coupled | Proprietary, library-coupled | Proprietary (JSON, but Lunr-specific loader) | Proprietary, library-coupled | Proprietary chunk/fragment format |
| Worker/WASM | Worker by default, optional WASM scoring core | `unclear` | No | No | Worker support, no WASM | WASM core (Rust) |
| Bundle size (core, gzip) | ~15KB budget (core) | "\<2KB" core claim (marketing; full package larger) | ~7KB | small, unconfirmed exact figure | 4.5-16KB depending on build | ~30KB init + ~75KB WASM |
| License | (this project) | Apache 2.0 | MIT | MIT | Apache 2.0 | MIT |

## Where this design already differentiates

- **Nobody else combines lazy HTTP-sharded delivery with full BM25F +
  boosts + facets + synonyms + i18n stemming.** Pagefind has the sharding
  architecture but not synonyms and no real fuzzy matching. Orama/
  FlexSearch have the relevance features but load the whole index into
  memory — there's no server, but there's also no *scaling* story for
  index size independent of first-load cost. This design's core bet
  (sharding + full relevance feature set together) is a real gap in
  the current landscape, not a redundant reinvention.
- **Nobody else treats the index format as an open, language-agnostic
  spec.** Every library surveyed — including the architecturally closest,
  Pagefind — requires *their* tooling to produce the index. This
  design's Python/Node/Java-producible JSON spec
  ([02-index-format.md](02-index-format.md#the-format-is-a-spec-not-a-library-dependency))
  is a genuine point of difference, not just a nice-to-have.

## Features worth cherry-picking

Concrete, specific borrows — each says *why* and *where it slots into
this design* rather than just "that library is good":

1. **Pagefind's `preload()` pattern.** Pagefind lets a site prefetch
   likely-needed index chunks (e.g., on search-box focus, before the
   user has typed anything) so the first keystroke feels instant. This
   design already prefetches configured facet shards
   ([06-faceted-search.md](06-faceted-search.md#facet-shard-fetch-strategy))
   but doesn't yet expose an equivalent term-shard warm-up hook. **Adopt**:
   add `client.preload(hint?)` to the API — see the addition in
   [07-client-api.md](07-client-api.md#warm-uppreload).
2. **Pagefind's zero-config `data-*` attribute authoring.** For static
   sites, Pagefind lets authors mark boosts/filters directly in HTML
   (`data-pagefind-weight`, `data-pagefind-filter`) with no separate
   config file — the indexer just reads the DOM. **Adopt** as an
   additional, optional source adapter (alongside the JSON-feed/CMS-API
   adapters already described in
   [01-architecture.md](01-architecture.md#offline-the-indexer)): a
   static-HTML adapter that recognizes the same-shaped `data-*`
   attributes, so migrating a Pagefind-based site costs nothing.
3. **FlexSearch's tunable memory/speed/accuracy presets.** FlexSearch
   ships named presets (`memory`, `performance`, `match`, `score`,
   `default`) trading index size against match quality/speed, rather
   than one fixed set of defaults. **Adopt**: expose an analogous
   coarse `profile` knob at build time (documented in an addition to
   [08-modern-features.md](08-modern-features.md#index-build-profiles))
   instead of only fine-grained BM25 k1/b tuning — most authors want a
   preset, not a formula.
4. **FlexSearch's persistent-storage adapters (IndexedDB, etc.).** Rather
   than only "fetch shards over HTTP, cache in memory," FlexSearch shows
   there's value in also persisting to IndexedDB for instant warm-starts
   across page loads within the same origin. **Adopt** as an extension
   of the existing offline plugin
   ([08-modern-features.md](08-modern-features.md#caching--offline-support)):
   the Service Worker precache plan already covers this at the HTTP
   layer, but an IndexedDB layer for *parsed* shards (not just raw
   bytes) avoids re-parsing cost on repeat visits, which the Service
   Worker cache alone doesn't buy you.
5. **MiniSearch's minimal, un-opinionated default analysis.** MiniSearch
   deliberately ships no stemming/stopwords by default and makes the
   tokenizer fully pluggable — it doesn't guess at "smart" defaults that
   might be wrong for a given corpus. This validates (rather than
   changes) this design's `LanguageProfile` approach
   ([03-tokenization-i18n.md](03-tokenization-i18n.md#pipeline-stages)):
   keep per-language defaults sensible out of the box, but never make
   them hard to override or disable per field.
6. **Orama's exposed BM25 parameters (k1, b, d).** Confirms the choice
   already made in
   [04-query-ranking-boosts.md](04-query-ranking-boosts.md#ranking-model-bm25f)
   to keep `k1`/`b` as documented, overridable manifest fields rather
   than hardcoding them — worth explicitly keeping parity with Orama's
   naming so anyone coming from Orama finds the knobs familiar.
7. **Lunr's `^` query-time boost syntax.** Lunr's `title:foo^3` inline
   boost syntax is widely recognized (same idea appears in Lucene/
   Elasticsearch query strings). This design's plain-string query form
   already adopts the same `field:term^boost` shape
   ([04-query-ranking-boosts.md](04-query-ranking-boosts.md#query-input-forms))
   deliberately, so it isn't a new idea to learn for anyone with
   existing search-query-syntax experience.

## Explicitly not cherry-picking

- **Orama's/Pagefind's "load-everything-into-WASM-at-init" pattern for
  small sites** isn't wrong, but it's the opposite of this design's core
  bet (lazy shard fetch) — for genuinely small corpora, the sharding
  overhead may not pay for itself either, which is a reason a "small
  corpus mode" (single unsharded index, still same format) might be
  worth a manifest flag rather than a reason to abandon sharding as the
  default. Noted as a roadmap consideration, not adopted outright.
- **FlexSearch's custom contextual/proximity-only scoring** (instead of
  BM25-family) is a legitimate alternative design, but mixing scoring
  paradigms would undermine the "one documented ranking formula" clarity
  goal — phrase/proximity is already incorporated as a *modifier* to
  BM25F ([04-query-ranking-boosts.md](04-query-ranking-boosts.md#phrase--proximity-queries)),
  which gets most of the benefit without a second ranking model to
  maintain and explain.
