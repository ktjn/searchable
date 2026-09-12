# Roadmap

Searchable should remain the smallest implementation that preserves its shipped behavior. This is the only current planning document. Completed implementation plans and superseded roadmaps belong in Git history, not in the active documentation tree.

## Constraints

- Preserve the public npm and Python APIs unless a separately approved breaking release changes them.
- Preserve manifest v2 and deterministic index output.
- Preserve TypeScript/Python client conformance.
- Preserve all shipped search, indexing, documentation, showcase, and CLI behavior.
- Prefer deletion, table-driven data, and local helpers over new architectural layers.
- A refactor is successful only when maintained LOC decreases. Moving the same code into more files is not simplification.
- Do not add a runtime dependency only to reduce repository LOC.
- Do not introduce an abstraction with one real consumer unless it deletes more complexity than it adds.

## Current product boundary

| Area | Current state |
|---|---|
| Index generation | Python-only static indexer |
| Runtime clients | TypeScript/browser and Python |
| Storage | Immutable JSON files over static HTTP/filesystem |
| Retrieval | Lexical BM25F |
| Query features | terms, phrases, prefix matching, synonyms, fuzzy matching, AND/OR |
| Result features | highlighting, did-you-mean, pinning, field/term/document boosts |
| Facets | terms, hierarchy, range, geo radius/distance, exact match on stored fields |
| HTML indexing | page-level plus optional section-level indexing |
| Languages | English, German, Swedish, Dutch, Bokmål, Nynorsk plus explicit fallback segmenters |
| Removed in 2.0 | binary index formats, vector/hybrid search, Worker runtime, Service Worker support |

The removed 2.0 capabilities stay removed unless a concrete consumer justifies a new product decision.

## Priority 1 — Delete test-fixture duplication

This is the highest-confidence LOC reduction because it changes test construction, not product behavior.

Current hotspots:

- `python/searchable/tests/fixtures/build_index.py`: 1,123 lines, 30 bespoke `write_*` fixture functions.
- `packages/searchable/test/e2e.test.ts`: 2,212 lines, 112 tests, heavy repeated manifest/index setup.

Work:

1. Replace Python's bespoke fixture writers with one composable index-fixture builder plus small named scenario descriptors.
2. Replace repeated TypeScript inline manifests/shards with shared builders under test support.
3. Convert repeated test shapes to table-driven cases where the assertion semantics stay readable.
4. Keep malformed-input fixtures explicit where exact bytes/shapes are the behavior under test.
5. Delete compatibility/test helpers that become single-line wrappers after migration.

Acceptance:

- No behavioral assertions removed.
- Cross-runtime conformance remains unchanged.
- Test names continue to identify the behavior being protected.
- At least 1,000 net maintained lines are deleted across test/support code before production search logic is refactored.

## Priority 2 — Simplify the showcase

`showcase/src/gallery-widget.ts` is 1,039 lines and manually constructs most UI controls. The gallery build/data files also repeat the same demo plumbing.

Work:

1. Introduce one small DOM element/control helper and drive controls from declarative descriptors.
2. Replace repeated `createElement` / `append` sequences with reusable render primitives.
3. Consolidate the `build-gallery*.ts` scripts around one generic gallery builder and per-demo configuration.
4. Keep corpus data separate where it improves readability; remove builder code duplication rather than hiding data.
5. Preserve every current demo, control, accessibility behavior, and browser test.

Do not introduce React or another UI framework for the showcase. That would increase the dependency and build surface for a small static site.

## Priority 3 — Reduce search-path duplication

The core search implementations are intentionally duplicated across TypeScript and Python because both are public runtimes. Do not attempt cross-language code sharing.

Current hotspots:

- `packages/searchable/src/search.ts`: 961 lines.
- `python/searchable/src/searchable/client/search.py`: 540 lines.

Within each runtime:

1. Represent a resolved query variant once: literal/synonym/fuzzy term, weight, and source kind.
2. Reuse that representation for shard selection, candidate collection, and scoring instead of repeating expansion loops.
3. Consolidate phrase-variant construction the same way.
4. Keep facet loading/filtering outside the lexical scoring loop.
5. Delete helper layers that merely forward arguments or rename values.
6. Keep TypeScript/Python behavior locked by the existing conformance fixtures.

Do **not** add the archived query-planner or plugin architecture as part of this cleanup. Revisit planning only if measured scale problems cannot be solved with simpler local changes.

## Priority 4 — Simplify the Python indexer

`python/searchable/src/searchable/indexer/build_index.py` is 723 lines and combines validation, normalization, page/section expansion, analysis, and index assembly.

Work:

1. Collapse repeated scalar/type validation only where a small shared primitive produces a net LOC reduction.
2. Unify page and section preparation through one internal prepared-document path.
3. Keep HTML extraction in `extract.py`; do not create another orchestration layer.
4. Remove parameters/configuration branches that no longer correspond to shipped behavior.
5. Preserve deterministic output and current error contracts unless a separate breaking change is approved.

Avoid a "split the monolith" refactor that only redistributes the same number of lines.

## Priority 5 — Repository and CI hygiene

- Keep this file as the only roadmap/current-plan source.
- Use Git history for completed implementation plans and old roadmaps.
- Keep ADRs for durable architectural decisions and archived specs only when they explain a still-relevant design boundary.
- Remove stale documentation references when the referenced implementation/design no longer exists.
- Consolidate repeated CI/release YAML only when the resulting workflow is easier to trace and has fewer maintained lines.
- Archive or delete the public-launch checklist after its final open decision is resolved.

## Quality work after simplification

These are evidence tasks, not reasons to expand the architecture:

- Refresh the documentation relevance corpus for the current 2.x docs surface.
- Expand judged relevance coverage only with representative domains and real query evidence.
- Add performance evidence for more corpus sizes, browsers, cache states, and low-end devices.
- Derive operating guidance and thresholds from recorded evidence rather than assumptions.
- Add new language profiles only with corpus, analyzer fixtures, relevance judgments, and cross-runtime conformance.
- Keep the public-index security guidance prominent: generated index artifacts are public data.

Ranking knobs, extension APIs, storage adapters, deeper diagnostics, and query planning remain deferred until a concrete consumer demonstrates that the current surface is insufficient.

## Non-goals

- Reintroducing binary storage, vector/hybrid search, Worker execution, or Service Worker support.
- A query-time backend.
- Browser-side index mutation.
- A plugin framework without multiple real consumers.
- A generic storage abstraction around static JSON.
- Framework adoption solely to reduce handwritten lines.
- Minified, generated, or deliberately dense source counted as a simplification win.

## Definition of done

A simplification slice is complete when:

1. Public behavior is unchanged.
2. Relevant unit, integration, browser, and TypeScript/Python conformance tests pass.
3. Relevance/performance baselines do not regress where the change can affect them.
4. Total maintained LOC decreases.
5. The change removes a concept, branch, duplicate representation, or repeated construction pattern rather than merely relocating it.
