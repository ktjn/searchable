# Python index-creation support: Phase 1+2 design

Status: approved, not yet implemented.

## Context

`docs/09-roadmap.md` Phase 7 and `docs/20-tech-stack.md` already commit to
Python as the project's second reference indexer implementation, but the
existing `spec/examples/python/generate_index.py` is deliberately minimal
(~100 lines, stdlib-only) — a proof that the index *format*
(`spec/schema/`) needs no particular language or library, not a
feature-complete indexer. This spec is the first step toward full feature
parity with the real reference indexer (`@ktjn/searchable-indexer` + `@ktjn/searchable-analysis` +
`@ktjn/searchable-format`, ~4,000 lines of TypeScript), shipped as an installable,
production-usable Python package rather than a one-off example script.

## Why this needs decomposition

Full parity (multi-language tokenization/stemming, facets, synonyms, fuzzy
matching, term pinning, vector embeddings, an optional binary storage
tier) is too large for one spec/plan/build cycle. This spec covers only
the first two phases, mirroring the order the TypeScript side itself was
built in (`docs/09-roadmap.md`'s own phased plan):

1. **`searchable_analysis`** — language detection, tokenization, stemming.
2. **`searchable_indexer` core** — HTML discovery/extraction, inverted index +
   BM25 fields, doc store, JSON manifest/shard writer, CLI.

Later, independently spec'd phases (not covered here):

3. Facets, synonyms, fuzzy matching, term pinning.
4. Vector shard building — the pluggable `embed()` callback and shard/
   quantization logic (`build-vectors.ts`), **without** a bundled default
   embedding model. `@ktjn/searchable-indexer`'s `transformers-embed.ts` (a real ONNX
   sentence-transformer runtime) is out of scope indefinitely for the
   Python port — Python callers supply their own embeddings (e.g. via
   `sentence-transformers`, an API, or precomputed vectors).
5. Binary storage tier.

## Package layout

A new top-level `python/` directory (parallel to how `spec/examples/`
already splits `typescript/` vs `python/`), keeping pnpm's `packages/*`
workspace glob (JS-only) untouched:

```
python/
  searchable-analysis/
    pyproject.toml
    src/searchable_analysis/
      __init__.py          # public exports
      language_profile.py  # LanguageProfile dataclass, the 7 profiles
      analyze.py           # analyze(), normalize_phrase()
      detect_language.py   # script-range + marker-word detection
      registry.py          # get_language_profile(), get_registered_language_codes()
      segment_latin.py     # regex-based word segmenter (en/de)
      segment_cjk.py       # bigram fallback (zh/ja)
      segment_sea.py       # trigram fallback (th/km/lo)
      segment_ngram.py     # shared windowing logic
      stemmer_en.py        # Porter stemmer
      stemmer_de.py        # Snowball German stemmer
    tests/
  searchable-indexer/
    pyproject.toml
    src/searchable_indexer/
      __init__.py
      cli.py                # `searchable-indexer <src-dir> <out-dir>` entry point
      discover.py           # walk directory, read .html files
      extract.py            # HTML -> ExtractedDocument (full searchable-* meta tag parsing)
      build_index.py        # tokenize + inverted index + doc store + BM25 fields
      write_index.py        # canonical JSON, content-hash, prefix/gzip sharding, manifest
      hash.py
      types.py              # SourceDocument, BuiltIndex, etc. (dataclasses)
    tests/
```

`searchable-indexer` depends on `searchable-analysis`, mirroring `@ktjn/searchable-indexer` →
`@ktjn/searchable-analysis`. There is no `searchable-format` package — the manifest/shard
shapes are plain dicts validated against `spec/schema/*.schema.json` in
tests, the same role `@ktjn/searchable-format`'s types play in TypeScript
(compile-time only, no runtime behavior to port).

**Tooling**: `uv` + `pyproject.toml` per package, `uv.lock` for
reproducibility. Minimum Python 3.10. CLI binary name `searchable-indexer`
(same name as the npm CLI — no collision risk in practice, since pip and
npm install bins into ecosystem-specific locations).

## `searchable_analysis` (Phase 1)

Direct port of the 7 `LanguageProfile`s (`en`, `de`, `zh`, `ja`, `th`,
`km`, `lo`) and the shared `analyze()` pipeline: NFKC-normalize →
segment → filter word-like → lowercase → fold diacritics → stem →
position, matching `packages/analysis/src/analyze.ts` exactly in
structure.

- **Stemmers**: Porter (en) and Snowball (de) are well-known, fully
  specified algorithms — line-for-line ports of
  `packages/analysis/src/stemmer-en.ts` / `stemmer-de.ts`, not
  reimplementations from scratch. Same German diacritic-folding caveat
  applies (the Snowball algorithm's own final step folds ä/ö/ü to a/o/u
  regardless of `foldDiacritics`).
- **CJK/SEA segmentation**: pure Unicode-range regex + fixed-width
  windowing (bigram for `zh`/`ja`, trigram for `th`/`km`/`lo`) — no ICU
  binding needed, ports directly from `segment-cjk.ts`/`segment-sea.ts`/
  `segment-ngram.ts`.
- **Latin (`en`/`de`) word segmentation**: the one real approximation.
  TypeScript uses `Intl.Segmenter` for word-boundary detection; Python
  has no stdlib equivalent. This port uses a Unicode-aware regex (a word
  = a run of `\w`-class Unicode letters/digits/marks, approximating
  UAX#29 word boundaries) instead. Per this repo's own stated philosophy
  (`spec/examples/README.md`), exact cross-implementation tokenization
  isn't the bar — internal index-time/query-time consistency within one
  implementation is what correctness actually depends on.
- **`detect_language()`**: pure regex character-counting + curated
  marker-word lists, no changes needed conceptually — direct port of
  `detect-language.ts`.

## `searchable_indexer` core (Phase 2)

- **`discover.py`** — trivial port: walk `src_dir` recursively, read
  every `.html` file, assign `id`/`url` by sorted path.
- **`extract.py`** — **full** parity with `extract.ts`, including facet/
  range-facet/pin metadata parsing (all `searchable-*` meta tags), even though
  `build_index.py` doesn't build shards from that data yet in this phase
  — this keeps `extract.py` untouched when Phase 3 lands, rather than
  needing a second pass through the same file. Fields extracted: title,
  body, language (`<html lang>` or `detect_language()` fallback),
  excerpt, canonical-URL (with the same scheme/origin-allowlist
  validation as the TS version), noindex, boost, facets, range facets,
  pins.
  - HTML parsing library: **`selectolax`** (Modest-engine, CSS-selector
    querying, fast, small dependency footprint) — chosen over
    `BeautifulSoup4`/`lxml` for speed and minimal transitive
    dependencies, matching this project's general bias toward small,
    fast, purpose-fit tooling over general-purpose kitchen-sink
    libraries.
- **`build_index.py`** — Phase 2 scope only: field boosts (default
  title=3.0/body=1.0, overridable), tokenization via `searchable_analysis`,
  inverted index (`df`/`postings`/`tf`/`pos`/`len` per
  `spec/schema/term-shard.schema.json`), doc store with stored fields
  (`spec/schema/doc-store-shard.schema.json`). Facets, synonyms, fuzzy,
  and pins are explicitly **not** implemented in this phase — no
  corresponding options/parameters exist yet on `build_index()` (added
  in Phase 3, not stubbed out now).
- **`write_index.py`** — canonical (recursively sorted-key) JSON
  serialization, SHA-256 content-hash filenames (`hash.py`,
  `hashlib.sha256(...).hexdigest()[:8]`), prefix+gzip-budget auto-
  sharding of term shards (direct port of the recursive
  `splitOversizedBucket` logic in `write-index.ts`, same
  `DEFAULT_MAX_TERM_SHARD_GZIP_BYTES` = 50KB default), manifest assembly
  matching `spec/schema/manifest.schema.json` — `format: "json"` only,
  no `facets`/`synonyms`/`pins`/`fuzzy`/`vectors` keys.
- **`cli.py`** — `searchable-indexer <src-dir> <out-dir>`, mirroring the npm
  CLI's argument shape (`packages/indexer/src/cli.ts`).

## Testing & CI

- `pytest` per package, run via `uv run pytest`.
- Unit tests per stemmer/segmenter/language-profile in `searchable-analysis`,
  matching the TS suite's per-module coverage
  (`packages/analysis/test/*.test.ts`).
- `searchable-indexer` tests: `build_index`/`write_index` against small fixture
  corpora, plus schema validation (Python `jsonschema` package) of
  every emitted manifest/term-shard/doc-store-shard against
  `spec/schema/*.schema.json`.
- **Cross-implementation conformance**: extend the existing pattern
  (`packages/client/test/cross-implementation-conformance.test.ts`
  already shells out to the *minimal* Python example generator) with a
  new conformance test that shells out to this **real** `searchable-indexer`
  Python CLI instead, builds an index from a shared multi-field/
  multi-language fixture, serves it over real HTTP, and asserts the same
  `SearchClient` query results (same matching doc ids for the same
  query text, not identical scores) as the TS-built index of the same
  fixture — consistent with this repo's existing documented tolerance
  for cross-implementation tokenization differences.
- **CI**: extend the existing `.github/workflows/ci.yml` `test` job
  (already runs `actions/setup-python@v6` with Python 3.12) with
  `uv sync` + `uv run pytest` steps for both new packages, run alongside
  the existing `pnpm test` step.

## Out of scope for this spec

Facets, synonyms, fuzzy matching, term pinning, vector shard building,
binary storage tier, and any bundled default embedding model — all
deferred to later, independently spec'd phases (see "Why this needs
decomposition" above).
