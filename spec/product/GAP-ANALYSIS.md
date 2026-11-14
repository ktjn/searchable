# Product capability extraction and gap analysis

**Date:** 2026-11-14. **Status:** proposed, review only. A checked item means documented/observed in the current Searchable 2.x repository, not certified for an Orama replacement.

## Evidence sources

- Current public scope: [README](../../README.md), [roadmap](../../docs/project/roadmap.md), [architecture](../../docs/concepts/architecture.md).
- Browser API: [TypeScript client](../../docs/reference/client-api.md), [source](../../packages/searchable/src/client.ts), [search result types](../../packages/searchable/src/search.ts).
- Secondary client: [Python API](../../docs/reference/python-client-api.md).
- Detailed behavior: [ranking](../../docs/guides/ranking-and-boosts.md), [facets](../../docs/guides/facets.md), [synonyms](../../docs/guides/synonyms.md), [pins](../../docs/guides/pinning.md), [languages](../../docs/reference/compatibility.md), [CMS extraction](../../docs/reference/cms-meta-tags.md).
- Publication/security/evidence: [manifest v2](../schema/manifest.schema.json), [security](../../SECURITY.md), [relevance baselines](../../docs/project/relevance-baselines.md), [CMS-2k performance baseline](../../docs/project/performance-baseline.md).
- Existing brownfield model: [system.yaml](../system.yaml) describes three capabilities and eleven mandatory requirements plus a deployment-specific non-mandatory classification requirement. It is too coarse to be the sole executable behavioral definition for a new engine.

## Current product versus expected client-side search

| Capability | Searchable 2.x observed | Proposed replacement outcome | Disposition |
| --- | --- | --- | --- |
| Static/public data, no search server | Supported; immutable JSON manifest/shards and plain HTTP | Preserve deployment/query contract, not on-disk representation | MVP |
| HTML + structured content | Rendered HTML, CMS metadata and structured indexing | Preserve normalized documents, inclusion/exclusion, sections | MVP |
| BM25F field-aware lexical ranking | Implemented | Relevance behavior; no exact BM25F formula or floating-point parity | MVP, changed semantics |
| Terms, AND/OR, prefix, quoted phrases | Implemented | Preserve user-facing semantics, verify Orama feasibility | MVP |
| Fuzzy and did-you-mean | Opt-in, limited to fuzzy query conditions | Defined bounded corrections and suggestions | MVP, extension of existing |
| Synonyms | Directional, equivalence, multiword, opt-in | Preserve authored expansion semantics | MVP; adapter/spike |
| Editorial pins | Priority/exclusive/contains | Preserve promotion; define filter interaction consistently | MVP; adapter/spike |
| Facets | Terms, hierarchy, range, contextual counts | Preserve accurate context-aware counts | MVP; adapter |
| Geo | Radius filtering + optional distance sort | Preserve geo, candidate validation and sorting | MVP |
| Exact filter on stored fields | Supported, but unknown field is ignored; pin behavior differs from facet filters | Unknown filter rejected; all visible results respect filters | MVP, intentional tightening |
| Highlighting | Literal-match spans; client exposes no HTML rendering | Plain-text spans/preview, safe rendering | MVP |
| Sort and pagination | Geo distance sort; result limit, no generic sort or offset in documented TS API | General scalar sort and offset pagination | MVP, gap |
| Query autocomplete | No documented direct suggestion API; did-you-mean only on some zero-hit fuzzy requests | Corpus-grounded prefix suggestions | MVP, gap |
| Language handling | en/de/sv/nl/nb/nn full; additional zh/ja/th/km/lo fallback segmenters; exact base tags | At least six full languages; resolve regional variants explicitly | MVP; locale policy review |
| Browser lifecycle | ready, search, facetValues, dispose, AbortSignal | Preserve cancellation/concurrent operation semantics | MVP |
| Streaming partial results | Advertised in top-level README; documented Python search_stream, not TypeScript SearchClient | No mandatory streaming API unless separately approved | Deferred/clarify docs |
| Python query client | Independent runtime, format and behavior conformance | Not required for browser-only clean-room replacement | Outside MVP |
| Lazy term shards | Core optimization in existing library | Budget-driven data transport; may instead use Orama prebuilt snapshot | Implementation choice |
| Manifest v2 JSON contract | Separate compatibility boundary | Independent new dataset format by default | Explicit migration decision |
| Worker/Service Worker and full offline | Explicitly removed in 2.x | Not imposed on Orama solution | Deferred |
| Vector/hybrid retrieval | Removed in 2.x | Not in scope despite Orama capability | Excluded |
| Framework/UI widgets | Headless API and independent showcase | Headless contract plus accessible reference integration | MVP |
| Quality evidence | 2k Chromium baseline; independently reviewed relevance sets; limited low-end/Firefox/WebKit | Establish accepted multi-device/multi-language budgets and query judgments | MVP evidence work |
| Private-content access control | Not supported by public index | Explicitly disallowed for publicly published content | Boundary |

## Intentional deviations requiring approval

1. **Algorithm independent:** behavioral ordering and judged relevance replace exact BM25F/float-score equivalence.
2. **Storage independent:** do not force the existing JSON manifest v2 or shard layout on Orama's serializer.
3. **API independent:** a new headless interface is allowed; a compatibility layer for the existing TypeScript/Python APIs is a separate feature.
4. **Filter strictness:** fail unknown filter fields and ensure promoted hits respect every active filter.
5. **Discovery and navigation:** add generic pagination, sorting, autocomplete and explicit interaction contracts.
6. **No forced source-code reuse:** clean-room implementation is not a refactor and does not count toward the current simplification roadmap.

## Orama evidence and compatibility considerations

OramaJS 3.x documents core full-text, fuzzy tolerance, filters, facets, sorting, offset/limit, multiple analyzers and in-memory search. These are **plausible implementation primitives**, not proof that the product contracts above are already met.

- [Orama introduction/search](https://docs.orama.com/docs/orama-js/search)
- [Orama sorting](https://docs.orama.com/docs/orama-js/search/sorting)
- [Orama stemming/languages](https://docs.orama.com/docs/orama-js/text-analysis/stemming)
- [Orama releases](https://github.com/oramasearch/orama/releases)
- [Orama source/license](https://github.com/oramasearch/orama)

**Do not assume** a built-in facility exactly handles ordered phrase matching, multilingual partitioning, contextual self-excluding facet counts, editorial promotion/filter composition, prefix suggestions, or versioned static snapshot compatibility. Prove each in a spike or implement it as a separately verified adapter. Orama's default in-memory model also does not guarantee Searchable's current term-level lazy HTTP transfer.

## Deliberate non-goals

No query-time backend, no hidden/private content, no default analytics, no mandatory vector/LLM feature, no automatic full-offline promise, no one-to-one legacy index-format parity, no replicated BM25F/index machinery.

**Decision:** Use this report to accept/refine the product specification and prioritize a feasibility spike before any implementation begins. Discovered engine limitations are scope/approval questions, not permission to silently remove approved requirements.
