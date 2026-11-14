# Client-side search engine — proposed system specification

**ID:** client-side-search | **Revision:** 0.1 | **Status:** proposed (requester approval required)

## 1. Mission and scope

Provide relevant, accessible search and faceted exploration of **published public content** from a static website, CMS export or document catalog. After publication, free-text queries are evaluated locally in the browser; no search API, user account or query-time write path is necessary.

**Actors:** publisher (prepares public content); integrator (configures search and builds UI); visitor (queries, filters, explores and follows results).

**Environment:** browser-based consumers, static HTTP hosting/CDN, an offline/build-time publisher. A non-browser consumer is optional and must not constrain browser search. A packaged headless query API is required; a built-in UI is not.

**Explicit exclusions:** private/permissioned search over a public static index, query-time hosted search, live index mutations in visitors' browsers, analytics collection by default, browser-native background agents, vector/hybrid search, mandatory UI framework, and a universal plugin framework.

**Compatibility:** The original Searchable 2.x manifest format and its exact BM25F scoring are not part of this proposed product contract. Existing APIs/formats remain governed by their own documentation until a separately approved migration decision.

## 2. Invariants

- **INV-01 Local queries:** raw search text is processed locally and is never submitted to an application search endpoint by the library. Static artifact requests can reveal accessed filenames/prefixes to a host/CDN; document this residual disclosure.
- **INV-02 Public data only:** any byte in a published search artifact must be considered public, including stored fields, excluded-result postings, metadata and content otherwise hidden by UI filters.
- **INV-03 Publication consistency:** one active search session must not silently combine incompatible dataset revisions; every published dataset identifies its own schema/version/build identity.
- **INV-04 Determinism:** equal dataset, query, options and supported runtime produce stable result ordering, tie-breaks and counts.
- **INV-05 Independence:** an implementation can be replaced if it meets approved contracts and independent acceptance tests; no mandated index data structures, ranking formulas, libraries or programming languages.
- **INV-06 Safe failure:** missing, invalid or incompatible data produces an actionable error, not fabricated/partial results presented as complete.
- **INV-07 Bounded work:** expensive optional features and resource consumption must be constrained by explicit limits and observable behavior.

## 3. Logical capabilities

| ID | Capability | Input → output | Contract boundary |
| --- | --- | --- | --- |
| C-01 | Content ingestion | Authorized source records → normalized public documents | Inclusion/exclusion, URL/canonical, field metadata, sections |
| C-02 | Dataset publication | Normalized records + policy → immutable publishable dataset | Version, integrity, cache/release consistency |
| C-03 | Query interpretation | Query + language/options → unambiguous query intent | Terms, phrases, prefix, AND/OR, expansion |
| C-04 | Retrieval and ranking | Query intent + dataset → deterministic relevance-ordered hits | Match correctness, scoring policy, stable tie-breaks |
| C-05 | Filtering and aggregation | Query/filters → matching set and contextual facet counts | Terms, range, hierarchy, geo, exact values |
| C-06 | Result presentation data | Matched documents → snippets, highlights and navigation URLs | Safe text spans, metadata, paging/sorting |
| C-07 | Discovery assist | Partial/failed query → suggestions/corrections | No misleading suggestions or user-data exfiltration |
| C-08 | Language analysis | Text + explicit/resolved locale → consistent language processing | Language boundaries and explicit fallback |
| C-09 | Client lifecycle | Dataset location + query calls → ready/results/errors/dispose | Concurrency, cancellation, cache and revision safety |
| C-10 | Host integration | Headless results/state → accessible client-side experience | Search-box, filters, status and navigation contracts |

The capabilities are logical. They do not prescribe a one-component-per-capability source layout. The implementation may use a library such as Orama to fulfill several capabilities.

## 4. Requirements

Each R-ID is a proposed requirement with matching verification cases in [ACCEPTANCE.md](ACCEPTANCE.md). **MVP** means required for an initial independently approved clean-room release; **E** means an extension requiring explicit approval.

### 4.1 Content and publication

| ID | Priority | Required behavior |
| --- | --- | --- |
| R-01 | MVP | Accept structured records with stable external IDs, canonical public URL, searchable fields, stored display fields, locale and optional metadata. Reject conflicting IDs and invalid required fields. |
| R-02 | MVP | Accept rendered HTML exports, respecting explicit no-index flags, selected searchable regions and excluded boilerplate. Provide document-level metadata and optional anchored sections without duplicate identities. |
| R-03 | MVP | Support configured field inclusion, field weights, display-only fields, facets, document boosts and editorial promotion rules. Record defaults and validation errors. |
| R-04 | MVP | Produce a deterministic, immutable, versioned static dataset with a manifest/release descriptor; safely publish it as a coherent generation. |
| R-05 | MVP | Browser consumers use ordinary static HTTP GET to load only public artifacts. No requirement for a query-time backend. |
| R-06 | MVP | Reject unsupported dataset versions, malformed payloads, unsafe resource references and incomplete generations before returning misleading results. |
| R-07 | E | Allow incremental build-time updates without changing query-time immutability; not required for initial replacement. |

### 4.2 Search semantics and relevance

| ID | Priority | Required behavior |
| --- | --- | --- |
| R-08 | MVP | Search across selected text fields with normalized case and accent behavior defined per language; return only documents that match the chosen query semantics. |
| R-09 | MVP | Support configurable AND and OR combination of analyzed terms, quoted ordered phrases and explicit prefix matching; handle invalid/empty input predictably. |
| R-10 | MVP | Rank organic matches by topical relevance; field boosts, term/document importance and deterministic tie-breaks must have documented observable precedence. No fixed BM25F score or algorithm is mandated. |
| R-11 | MVP | Offer opt-in, bounded typo tolerance. Exact matches must not be unpredictably displaced by approximate matches. |
| R-12 | MVP | Offer authored equivalent, directional and multiword synonyms with language scoping, cycle/expansion limits and predictable precedence. |
| R-13 | MVP | Support editorial promotion/pinning including deterministic conflicts, deduplication and explicit interaction with filters and organic ranking. |
| R-14 | MVP | Return stable total counts, bounded result pages, relevance ordering and declared metadata. Support offset/page-size and sort by approved scalar fields. |
| R-15 | MVP | Produce display-safe excerpts and match span metadata for literal terms; callers own HTML escaping and rendering. Never emit trusted executable markup. |
| R-16 | MVP | Return bounded spelling suggestions for no-result or approximate queries, and prefix-based autocomplete candidates where there is supporting corpus evidence. |
| R-17 | E | Support cross-field proximity/slop search or advanced boolean query syntax beyond the specified simple query grammar. |

### 4.3 Filter, facet, navigation and location

| ID | Priority | Required behavior |
| --- | --- | --- |
| R-18 | MVP | Support term/exact-value filtering (OR within one field, AND across fields); reject or clearly report unknown filters rather than silently broadening results. |
| R-19 | MVP | Support inclusive numeric range filtering, hierarchical taxonomies, and geo-radius filtering when declared in the dataset. |
| R-20 | MVP | Return contextual facet counts: each facet's counts reflect the query and all other active filters, excluding that facet's own active selection. |
| R-21 | MVP | Preserve navigable, validated public URLs and optional section anchors, with enough metadata to group section hits by parent document. |
| R-22 | E | Support group-by/collapse across matched sections and distinct-result grouping if consumers require it. |

### 4.4 Languages, lifecycle and resilience

| ID | Priority | Required behavior |
| --- | --- | --- |
| R-23 | MVP | Support at least English, German, Swedish, Dutch, Norwegian Bokmål and Nynorsk; permit explicit language selection and deterministic fallback for unsupported/unknown locales. |
| R-24 | MVP | Keep index-time and query-time analysis compatible for every supported language. Search must not silently mix incompatible language partitions. |
| R-25 | MVP | Provide an explicit ready/failed/disposed lifecycle and typed failures for download, decode, incompatible version, invalid config and query cancellation. |
| R-26 | MVP | Concurrent queries against one client produce isolated, deterministic results and do not corrupt shared state. |
| R-27 | MVP | Query cancellation stops delivering stale caller results; disposal prevents further use. Shared reads may continue if needed by other callers. |
| R-28 | MVP | Support bounded memory and download consumption, controlled concurrency, and effective ordinary HTTP caching. Optional search capabilities should not impose unavoidable excessive initial cost. |
| R-29 | E | Fully offline operation after initial install and persistent on-device indexes require their own approval; ordinary cached HTTP is sufficient for MVP. |

### 4.5 Security, privacy, UX and quality

| ID | Priority | Required behavior |
| --- | --- | --- |
| R-30 | MVP | Disallow private or access-controlled content in publicly published artifacts. Validate canonical URLs and block unsafe URL schemes, path traversal and unapproved cross-origin artifact fetching. |
| R-31 | MVP | Never upload raw search terms, searches or result clicks by default. Explain that hosting access logs and query-derived artifact URLs can still expose access patterns. |
| R-32 | MVP | Untrusted strings, filter keys, metadata and display fields are handled as data without prototype pollution, code execution, DOM injection or uncontrolled crashes. |
| R-33 | MVP | Expose a headless UI integration contract for input, submit/change, busy, results, zero-results, error, filters, paging, suggestions and navigation; do not require React or another framework. |
| R-34 | MVP | Reference interaction patterns satisfy keyboard navigation, appropriate status announcements, focus management and WCAG 2.2 AA when rendered by a conforming integrator. The headless engine does not itself claim UI accessibility. |
| R-35 | MVP | Measure cold/warm search latency, transfer bytes, parse/index-load time, peak heap, bundle impact and relevance on representative real browsers, languages, corpora and devices. Agree acceptance budgets before implementation. |
| R-36 | MVP | Verify relevance through maintained, reviewed query judgments and ranking metrics (e.g. nDCG@5, MRR, zero-result rate) plus per-query regression analysis, not by copying existing engine numeric scores. |
| R-37 | MVP | Version the public headless API and dataset format independently; provide migration/rollback guidance for intentional breaking changes. |
| R-38 | E | Optional telemetry integration may expose events/hooks controlled by integrators; the library must not activate remote analytics by default. |

## 5. Data semantics (not a storage schema)

**SearchDocument:** external ID, canonical URL, locale, title, searchable field map, stored field map, optional facets, numeric fields, geo point, parent/section relationship, ordinal, editorial metadata. All document content supplied to a public search dataset is public.

**DatasetDescriptor:** product data-format version, build identity, data location(s), languages, field capabilities, locale analysis policy, optional artifact integrity/digests, and compatibility information.

**SearchRequest:** query string, locale, required/optional query clauses, filters, facet requests, expansion options, sort, offset and limit, cancellation handle.

**SearchResponse:** ordered hits with external IDs/URLs/score *or comparable ranking signal*, count, applied language, contextual facets, optional suggestions, highlight spans and coherent dataset generation identity.

**SearchFailure:** typed category, recoverability, affected operation and safe message. An error is not a zero-result search.

**Ordering:** externally visible IDs/URLs must be stable within a dataset. Scores need not be numerically comparable across library versions, languages, indexes or query types.

## 6. Quality and risk register

| ID | Risk | Treatment / acceptance obligation |
| --- | --- | --- |
| K-01 | Public index accidentally discloses hidden/private fields | Publisher field classification, public-data gate, negative extraction test (R-30) |
| K-02 | Orama's in-memory snapshot increases first-query time and heap vs existing lazy shards | Compare candidate delivery modes against baselines and low-end browser budget (R-28, R-35) |
| K-03 | Different BM25/tokenization gives materially different ranked outcomes | Independently judged relevance + accepted regression deltas (R-10, R-23, R-36) |
| K-04 | Original BM25F phrases/synonyms/pins cannot be recreated directly by Orama APIs | Isolate adapters; use acceptance cases and do not promise 1:1 algorithmic parity (R-09, R-12, R-13) |
| K-05 | A partial CDN deployment mixes generations | Immutable release units, descriptor-first activation and fault injection (R-04, R-06) |
| K-06 | Indexed query fragments leak into static-file access logs | Document threat model and avoid raw-query URL requests (R-31) |
| K-07 | Unsupported locale or analyzer mismatch reduces recall | Independent multilingual corpus and language-boundary tests (R-23, R-24) |
| K-08 | Candidate engine's persistence format changes across releases | Pin library and dataset version, smoke-test load/rollback (R-06, R-37) |
| K-09 | UI renders untrusted snippets unsafely | Return spans/plain text only; test host integration separately (R-15, R-32, R-34) |

## 7. Approval gate

Before implementation, requester approval must specify:
- Which R-IDs are adopted in the first release, and any agreed exceptions/deferred capabilities.
- Corpus sizes, supported browser/device matrix and performance budgets, using measured data.
- Relevance thresholds and reviewed query sets for required locales.
- Whether the new engine must preserve Searchable 2.x API and/or manifest v2 compatibility (default: neither).
- Feature-level verification baseline revision and explicit acceptance owner.

Implementation evidence must be collected after approval against the actual Orama-based artifact, not inherited from the original \`spec/system.yaml\` verification records.
