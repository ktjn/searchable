# Roadmap & Open Questions

## Phased build plan

**Phase 0 — Spec & fixtures**
- Freeze the manifest/shard JSON schema (this repo's docs +
  machine-checkable JSON Schema files).
- Build a small multi-language fixture corpus (English, German, Japanese,
  Arabic at minimum) used by every later phase's tests — recommend
  grounding this in a real ~2,000-document CMS export (see
  [14-reference-deployment-cms-2k.md](14-reference-deployment-cms-2k.md)),
  which is also the concrete initial deployment target for the whole
  project, alongside synthetic Zipfian corpora for scaling benchmarks.

**Phase 1 — Minimal viable engine (single language, JSON tier only)**
- Reference indexer (one implementation, e.g. Node) producing the
  manifest + term shards + doc store for English only.
- Browser runtime: manifest fetch, term shard fetch, boolean AND query,
  plain TF-IDF or BM25 (no field weighting yet), no worker (main thread).
- Goal: prove the shard-fetch-on-demand model works end-to-end.

**Phase 2 — Ranking & boosts**
- BM25F with field boosts, term boosts, document boosts.
- Prefix matching.
- Move execution into a Web Worker.

**Phase 3 — Facets**
- Facet shard format, filtering, contextual counts, range facets.

**Phase 4 — I18n**
- LanguageProfile abstraction, additional stemmers, `Intl.Segmenter`
  integration, CJK bigram fallback, per-language partitions.

**Phase 5 — Synonyms & fuzzy**
- Query-time synonym expansion.
- SymSpell fuzzy plugin, "did you mean".

**Phase 6 — Modern features polish**
- Streaming results, highlighting, offline/Service Worker plugin,
  bundle-size CI gate, accessibility pass, observability hooks.

**Phase 7 — Scale options**
- Binary tier codec (plus a Range-request-capable single-file postings
  variant), benchmarked against JSON at 10k/100k/1M synthetic corpus
  sizes to empirically set the size/density threshold where it's worth
  switching — see the investigation in
  [11-binary-vs-json-index.md](11-binary-vs-json-index.md) — optional
  WASM scoring core, federated multi-index search, second/third-language
  indexer implementations (Python, Java — see
  [10-testing-and-performance.md](10-testing-and-performance.md)) to
  prove the format is genuinely implementation-agnostic and not just
  agnostic in principle.

**Phase 8 — Vector & hybrid search**
- Embedding shard format, chunking, quantization (int8 default), brute-
  force cosine similarity scoring, RRF-based hybrid fusion with lexical
  BM25F results, opt-in coarse clustering for larger corpora. Full design
  in [13-vector-and-hybrid-search.md](13-vector-and-hybrid-search.md).
  Deliberately sequenced after the lexical engine is proven out (Phases
  1-6), since it's additive, higher-complexity, and depends on choices
  (embedding model, quantization thresholds) best validated against a
  working baseline rather than upfront.

Each phase should be shippable/usable on its own (e.g. Phase 1 alone is
already a usable, if basic, client-side search engine) — this is
sequencing for incremental value, not a waterfall gate.

## Open questions

- **Incremental index updates.** Today, any content change means a full
  rebuild + republish. Is a "patch" format (diff of postings since last
  build) worth the complexity for large corpora with frequent small
  edits, or is "just rebuild, it's fast and cheap" good enough given
  target corpus sizes? Leaning toward the latter until a concrete
  use case proves otherwise — full rebuilds keep the whole system much
  simpler (see the simplicity principle in
  [00-overview.md](00-overview.md)).
- **Personalization/ML ranking.** Out of scope for the core (see
  non-goals), but should the API leave a documented extension point
  (e.g. a client-side re-ranking hook fed a feature vector per hit) so
  consumers can layer their own signals without forking the engine?
- ~~**Vector/semantic search.**~~ Resolved into a concrete design — see
  [13-vector-and-hybrid-search.md](13-vector-and-hybrid-search.md) and
  Phase 8 above. Remaining open sub-question: whether shipping a
  client-side embedding model (tens of MB) is an acceptable default cost
  for deployments that enable `plugin:vector`, or whether the remote-API
  escape hatch ends up being the common case in practice — needs real
  deployments to answer, not speculation.
- **Auto language detection accuracy.** How much bundled model size is
  worth it for higher detection accuracy vs. just requiring explicit
  `language` tagging for anything beyond a few high-resource languages?
- **Cross-index score normalization** (federated search,
  [07-client-api.md](07-client-api.md#federated-multi-index-search)) —
  min-max vs z-score vs learned normalization; needs empirical testing
  against real multi-corpus fixtures before picking a permanent default.

## Explicit non-features (revisit only with a concrete driver)

- Real-time index mutation from the browser (this is a read-only
  runtime by design).
- Server-side query logging/analytics baked into core (left as an
  observability hook, see [08-modern-features.md](08-modern-features.md#observability-hooks)).
- Built-in UI components beyond example code (kept as separate optional
  packages so core stays framework-agnostic).
