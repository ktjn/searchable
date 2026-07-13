# Python index-creation support: Phase 3 design (facets, synonyms, fuzzy, pins)

Status: approved, not yet implemented.

## Context

Phase 1+2 (`docs/superpowers/specs/2026-07-11-python-indexer-phase1-2-design.md`,
merged in PR #13) shipped `searchable-analysis` and the lexical core of
`searchable-indexer` — a working, queryable JSON index with no facets,
synonyms, fuzzy matching, or term pinning. `extract.py` already parses
`searchable-facet-*`, `searchable-facet-range-*`, and `searchable-pin*` meta tags (for
forward compatibility, per the Phase 1+2 spec), but `build_index.py`
has never consumed that data. This spec covers the third phase from
the original decomposition: making that data actually build shards.

## Scope

All four features ship together, matching the granularity of the
TypeScript reference implementation (`packages/indexer/src/build-index.ts`),
which implements all four as options on one `buildIndex()` call sharing
the same per-document processing loop — splitting them into separate
phases would mean repeatedly revisiting `build_index.py` instead of
once.

Still out of scope for this phase (deferred to later, separately spec'd
phases): vector embeddings (`build-vectors.ts`), the binary storage
tier (`binary-*.ts`).

## Module layout

New modules under `python/searchable-indexer/src/searchable_indexer/`, splitting by
concern rather than mirroring `build-index.ts`'s single 840-line file —
consistent with how the Python port has split every other TS file with
more than one responsibility so far (`segment_cjk.py`/`segment_sea.py`
instead of one segmentation file, `stemmer_en.py`/`stemmer_de.py`
instead of one stemmer file):

- **`facets.py`** — `add_facet_values()` (terms/hierarchy facets,
  including hierarchy-path expansion, e.g. `"a>b>c"` →
  `["a", "a>b", "a>b>c"]`), `add_range_facet_values()`, and the two
  bucket-computation strategies (`compute_range_facet_buckets_equal_width()`,
  default 5 equal-width buckets over the observed `[min, max]`;
  `compute_range_facet_buckets_explicit()`, author-chosen ascending cut
  points) — direct ports of `build-index.ts`'s `addFacetValues`/
  `addRangeFacetValues`/`computeRangeFacetBuckets{EqualWidth,Explicit}`/
  `expandHierarchyPaths`/`addToBucket`.
- **`synonyms.py`** — `build_synonym_shards()`: normalizes
  author-supplied `equivalences`/`directional`/`multiWord` entries
  through each language's own `normalize_phrase()` (from
  `searchable_analysis`), so a synonym authored as a surface form matches
  however that term is actually stored. Drops empty/single-member
  groups. Direct port of `buildSynonymShards`.
- **`fuzzy.py`** — `build_fuzzy_shard()`: SymSpell-style deletion
  dictionary from a language's own indexed vocabulary, `maxEdits` 1 or
  2 (breadth-first expansion, each level deleting one more Unicode code
  point). Direct port of `buildFuzzyShard`/`generateDeletes`.
- **`pins.py`** — `resolve_pins()`: resolves accumulated per-language,
  per-phrase pin declarations into final shard shape, applying the
  priority → doc-boost → insertion-order tie-break
  (`docs/16-term-to-page-pinning.md#conflicting-pins`), returning one
  warning string per phrase pinned by more than one distinct page.
  Direct port of `resolvePins`.

## `build_index.py` changes

New keyword arguments on `build_index()`, matching the existing
plain-kwarg style established in Phase 2 (`field_boosts`,
`allowed_url_origins`, `canonical_base_url`) rather than a bundled
options object:

- `hierarchical_facets: dict[str, dict] | None = None` — field name →
  `{"separator": str}` (default separator `">"`).
- `range_facet_buckets: dict[str, int | list[float]] | None = None` —
  field name → either a positive int (equal-width bucket count) or an
  ascending list of finite floats (explicit cut points). Invalid values
  raise `ValueError` matching the TS error message wording, validated
  up front before any document processing (same fail-fast pattern as
  Phase 2's doc-id validation).
- `synonyms: dict[str, dict] | None = None` — language code →
  `{"equivalences": [[str, ...]], "directional": {str: [str, ...]},
  "multiWord": [[str, ...]]}` (all three keys optional).
- `fuzzy: bool = False` — build a fuzzy deletion dictionary per
  language from that language's own indexed vocabulary.
- `fuzzy_max_edits: int = 1` — must be `1` or `2`; validated up front,
  `ValueError` otherwise. Ignored when `fuzzy=False`.

The per-document loop now also calls `add_facet_values()`/
`add_range_facet_values()` (using `extracted.facets`/`.range_facets`,
already parsed) and accumulates `extracted.pins` per language (using
`normalize_phrase()` on each pin's phrase, discarding empty results) —
mirroring the TS loop's existing calls, just previously absent from the
Python port.

`BuiltIndex` (in `types.py`) gains four new fields: `facet_shards:
dict[str, dict]`, `pins_shards: dict[str, dict]`, `synonym_shards:
dict[str, dict]`, `fuzzy_shards: dict[str, dict]` — populated even when
empty (empty dicts), matching the existing all-fields-always-present
dataclass convention.

## `write_index.py` changes

- Writes `facets/<field>.json` for every non-empty facet shard (field
  names sorted), content-hashed like term/doc-store shards.
- Writes `pins/<lang>.json` for every language with at least one
  resolved pin phrase.
- Writes `synonyms/<lang>.json` for every language with at least one
  non-empty `equivalences`/`directional`/`multiWord` entry.
- Writes `fuzzy/<lang>.json` for every language with a non-empty
  deletion dictionary (JSON format only — no `binary` option in this
  phase, consistent with term/doc-store shards staying JSON-only).
- Manifest gains: `facetFields` (sorted list of field names, only
  present if non-empty), `shards.facets` (array of `{field, file}`),
  `pins` (language → file path, only present if non-empty), `synonyms`
  (language → file path, only present if non-empty), `fuzzy` (language
  → `{file}`, only present if non-empty) — matching
  `spec/schema/manifest.schema.json` exactly, same optional-key
  conventions already used for `shards.docs`/`shards.terms`.

## Testing

- Unit tests per new module (`facets.py`, `synonyms.py`, `fuzzy.py`,
  `pins.py`), covering: hierarchy-path expansion including shared
  ancestor deduplication, both range-bucket strategies including the
  single-distinct-value edge case, synonym normalization/dedup/empty-
  group dropping, fuzzy deletion generation at both edit depths,
  pin conflict resolution and its tie-break order, pin-conflict warning
  generation.
- `build_index.py`/`write_index.py` integration tests: a corpus with
  terms facets, a hierarchical facet, a range facet (both bucket
  strategies), synonyms, fuzzy enabled, and pins — asserting the
  resulting `BuiltIndex`/written shard files match expectations.
- Schema-conformance tests (`test_schema_conformance.py`) extended to
  validate emitted `facets/*.json`/`pins/*.json`/`synonyms/*.json`/
  `fuzzy/*.json` against `spec/schema/facet-shard.schema.json`/
  `pins-shard.schema.json`/`synonym-shard.schema.json`/
  `fuzzy-shard.schema.json`.
- Cross-implementation conformance test
  (`cross-implementation-conformance-python-indexer.test.ts`) extended
  with a second `describe` block (or a new fixture in the existing one)
  building an index with facets/synonyms/fuzzy/pins configured on both
  the TS and Python sides, asserting matching facet counts / pin-boosted
  ranking / fuzzy-typo-tolerant results via `SearchClient`.

## Out of scope for this spec

Vector embeddings, binary storage tier — deferred to later,
independently spec'd phases.
