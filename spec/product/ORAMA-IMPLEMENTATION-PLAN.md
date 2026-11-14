# Orama-based independent implementation — proposed plan

**Status:** proposed implementation candidate, NOT approved implementation authorization.
**Product contract:** [SYSTEM.md](SYSTEM.md) and [ACCEPTANCE.md](ACCEPTANCE.md). Orama is an implementation choice; do not mention it in normative product requirement wording.

## 1. Clean-room delivery rules

- Implement in a **separate repository/source tree** after the requester approves a complete feature/verification baseline. Do not port/copy the current Searchable 2.x Python or TypeScript code, tests, generated shards or algorithms.
- The implementer receives only the approved product spec, independently authored fixtures, public Orama documentation, public web standards and the project's own new code.
- Black-box comparisons to the original product may inform **gap review only**; do not blindly promote differences to requirements or clone exact scores/artifact bytes.
- Keep original Searchable implementation-model evidence and Orama candidate evidence completely separate. Never mark a candidate requirement \`verified\` without candidate-specific verification.
- A formal legal clean room would require two isolated teams; the current spec author has inspected the implementation. Describe this effort accurately as **independent, contract-driven reimplementation**, not guaranteed legal isolation.
- Orama is an Apache-2.0 third-party dependency; pin versions, retain notices, check transitive licenses, SBOM and vulnerability alerts.

## 2. Proposed architecture

\`\`\`text
Public HTML / CMS export / structured records
        |
        v
Independent source adapters + inclusion/security policy
        |
        v
Validated public SearchDocument records
        |
        +----> Dataset builder (Orama, build-time TS/Node)
                    |
                    +--> Candidate A: create/insert -> save -> static snapshot
                    +--> Candidate B: static normalized docs -> browser create/insert
                    |
                    v
           Versioned immutable static release + descriptor
                    |
                    v
           Browser fetch/validate/restore-or-build
                    |
                    v
                 Orama search
                    |
            Search semantics adapter
        (synonyms / facets / pins / phrases / UX)
                    |
                    v
          Framework-neutral public client API
                    |
                    v
       Consumer UI (React optional, accessible)
\`\`\`

**Logical units (not prescribed source paths):**
1. Source adapter: HTML/structured ingestion and public-data exclusion.
2. Dataset publisher: deterministic builds, field schema, revision descriptor and atomic release.
3. Browser dataset loader: fetch, validation, versioning, cache/revision consistency, lifecycle/cancellation.
4. Orama search adapter: lexical query, sorting, filters, facets, ranking configuration, stable IDs and bounded expansion.
5. Search experience adapter: suggestion, excerpt/highlight spans, promotion, and navigation.
6. Verification harness: black-box requirements, independent judgments, browser/performance/security cases.

Implement independently testable units with programmable dependency fakes; test integration after unit verification. The product spec remains independent of those chosen units.

## 3. Primary decisions

### Orama version and API

Evaluate **@orama/orama 3.1.x** at a pinned, reviewed version; 3.x search APIs are documented as synchronous. Do not assume older async examples, plugin contracts or persistence versions apply. Confirm the exact package version at spike time.

- Use Orama's documented \`create\`, \`insertMultiple\` or \`insert\`, \`search\`, \`save\`, and \`load\` APIs only when verified for the pinned release.
- Translate product query options at one boundary; never expose Orama's raw internal ID or undocumented index structures in the public product API.
- Use Orama's native BM25 relevance as the starting point, NOT a custom BM25F port. Keep score semantics as \`relevance\` and validate judged ordering.
- Prefer the core serializer before adding persistence plugins. Historical browser bundling issues around plugin-specific Node streams require smoke tests; do not assume all persistence formats load in browsers without polyfills.
- Do not load Orama Cloud, remote embeddings, remote model proxies, or analytics features. This is a local browser lexical engine.

### Static index delivery: decision spike, not assumption

Evaluate two independently implementable modes:

| Mode | Build | Browser | Trade-off |
| --- | --- | --- | --- |
| A — Prebuilt Orama snapshot | Build Orama index, serialize in Node, publish versioned snapshot | Fetch descriptor and snapshot, restore Orama instance | No browser reindex; higher initial transfer/deserialize and heap possible |
| B — Public structured document feed | Normalize source records and publish compact public JSON | Fetch documents and construct Orama index in browser | Simpler artifact and compatibility; indexing CPU/long tasks on every fresh load |

**Default hypothesis:** A for ~2,000 documents, pending measurements. B remains a valid fallback if snapshot stability, size or browser restore is worse. The existing lazy-by-term Searchable sharding is not presumed necessary or desirable. Segmenting Orama indexes by locale or collection is an **optimization experiment** only if full-dataset measurements fail; do not split result sets before defining cross-segment ranking, facets, pagination and deterministic merge behavior.

**Publish protocol:** hash/version every immutable artifact, publish complete generation to a new path, verify it, then atomically switch a short-cached descriptor. A browser query pins one generation. Older compatible assets remain available during rollback windows.

### Language design

Create one independent Orama index per required language if this is the simplest reliable way to align analysis and avoid mixed-language query mistakes. Orama's \`@orama/stemmers\` includes English, German, Swedish, Dutch and a generic Norwegian stemmer. Confirm distinct **nb**/**nn** partition semantics and locale-to-tokenizer mapping in the adapter; do not claim distinct Norwegian stemming algorithms. Unsupported BCP 47 variants need a reviewed fallback policy.

### Query/feature adapters and feasibility gates

| Product obligation | Likely Orama primitive | Work requiring a spike or adapter |
| --- | --- | --- |
| Lexical search, relevance, field boosts | \`search(term, boost/properties)\` | Behavioral ranking/relevance judgments; stable ties |
| Fuzzy tolerance | \`search(tolerance)\` | Literal/approximate precedence, caps, correction suggestions |
| Terms filtering and facets | \`where\`, \`facets\` | Contextual counts excluding active same-field filter; unknown-field strictness |
| Range, scalar sort and pagination | Typed schema, \`where\`, \`sortBy\`, \`offset\`, \`limit\` | Preserve exact inclusive boundary and stable paging rules |
| Geo search | Orama geo support | Radius/distance ordering, coordinate validation |
| Multilingual search | Per-index tokenizer/stemmer | nb/nn, fallback locale, mixed-language transitions |
| Quoted phrases and explicit prefix | Search input and tokenizer | **Do not assume** exact positional semantics; test capability before committing MVP |
| Authored synonyms | Explicit query variants or controlled augmentation | Directionality, multiword semantics, caps, dedupe and relevance |
| Editorial pins | Orama pinning if suitable or separate ordering adapter | Exact/contains/exclusive behavior; all filters still apply |
| Highlight and snippets | Plain text from stored fields; optional Orama highlight plugin | Safe spans, Unicode offset consistency, no injected HTML |
| Autocomplete/did-you-mean | Corpus terms or separate build-time vocabulary | Bounded prefix completions and typo candidates without unnecessary data download |
| Cancellation and concurrency | Promise wrapper around loading; sync Orama query | Native synchronous search cannot be interrupted mid-computation; gate on bounded work, stale-result suppression and main-thread latency |

**Hard feasibility gates before MVP implementation:** ordered phrase matching; contextual facet counts; multiword synonym/pin composition; snapshot restore stability; low-end browser main-thread cost; Norwegian language behavior; filter/pin consistency. If any fail, document alternative contract-preserving approaches and ask the requester to approve scope/implementation changes.

## 4. Proposed headless interface

The API shape below is illustrative and **not normative**:

\`\`\`ts
interface SearchEngine {
  ready(): Promise<void>;
  search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResponse>;
  suggest(prefix: string, options?: SuggestOptions): Promise<Suggestion[]>;
  facets(request: FacetRequest): Promise<FacetResponse>;
  dispose(): void;
}
\`\`\`

Hide Orama-specific methods/types behind the adapter. The publisher exports plain public documents and an independent dataset format; external IDs, URLs, fields, filters and result semantics live at the product boundary. Avoid a separate Python runtime unless independently demanded.

## 5. Implementation phases and exit criteria

**Phase 0 — specification approval (required before implementation).**
- Review [SYSTEM.md](SYSTEM.md), [ACCEPTANCE.md](ACCEPTANCE.md), and the deviations in [GAP-ANALYSIS.md](GAP-ANALYSIS.md).
- Agree MVP feature IDs, test expectations, locales, compatibility stance, security posture, budgets and approval record.
- No code is changed in this PR.

**Phase 1 — constrained Orama feasibility spike (after approval).**
- Pin library; test raw documents vs prebuilt save/load on independent 2k/10k/50k datasets.
- Test phrase/prefix semantics, contextual facets, synonyms, promotions, nb/nn, errors and low-end browser cost.
- Produce a trade-off decision with measured bytes/time/heap, unsupported cases, and proposed scope changes. Reopen approval for any behavior changes.

**Phase 2 — publisher and transport.**
- Implement source adapters, public-data gate, normalized schema and immutable versioned deployment.
- Verify malformed data, repeatability, provenance, URL sanitization, cache coherence and rollback.

**Phase 3 — headless query client.**
- Implement stable public API using Orama, query translation, precise filter semantics, ranking/order, suggestions, highlights, lifecycle and bounded operations.
- Verify isolated units against fakes and run black-box acceptance cases against built artifacts.

**Phase 4 — product integration and independent assurance.**
- Build minimal accessible HTML/React demo (React is optional) exercising keyboard flow and error/empty cases.
- Run all supported browser/device performance matrix, independent relevance judgments, security tests, packaging/license audit.
- Fix defects without changing approved requirements. Route specification gaps back through approval.

**Phase 5 — replacement decision.**
- Present requirement-linked evidence, unresolved gaps/risks, and a migration/rollback plan.
- Choose whether this is a **new product/package**, a parallel implementation, or an approved replacement of old APIs. Do not overwrite the existing library based only on passing demo tests.

## 6. Baselines, benchmarks and budget decisions

The existing [Searchable CMS-2k baseline](../../docs/project/performance-baseline.md) records 2,006 documents, ~635 KiB gzip-equivalent artifact total, and cold single-term p95 ~16.6 ms for initialization+query in one Chromium environment. **This is not a release target for Orama or a portable cross-browser SLA.**

Benchmark total artifact bytes, initial transfer, number of requests, browser parse/restore vs rebuild, first query p50/p95, warm query, heap peak/settled, long tasks/input latency, bundle size, and filter/facet worst-case. Test 2k/10k/50k docs on desktop + lower-end mobile with Chromium/Firefox/WebKit. Do not set hard thresholds until measured and approved.

## 7. Risks and open decisions

- Orama save/load serialization can be sensitive to version changes; pin version and independent product dataset revision, and test old/new release combinations.
- Orama data persistence plugins may increase browser bundle size or require Node polyfills. Prefer core save/load if viable.
- In-memory loading removes the original term-shard transfer advantage. Benchmark before deciding whether to partition.
- Phrase, synonym and pin requirements may need substantial adaptation; avoid implementing a second full query engine on top of Orama.
- Relevance cannot be asserted from BM25 naming alone; compare independent judged results.
- A strict "clean room" cannot be claimed where the same author already inspected legacy source.
- Clarify whether 2.x public API or manifest v2 consumers exist before any replacement; compatibility has nontrivial cost.

## 8. Source references (implementation research only)

- [Orama 3.x introduction](https://docs.orama.com/docs/orama-js)
- [Search, tolerance, offset and result shape](https://docs.orama.com/docs/orama-js/search)
- [Sorting](https://docs.orama.com/docs/orama-js/search/sorting)
- [Stemming and language packages](https://docs.orama.com/docs/orama-js/text-analysis/stemming)
- [Orama upstream source and releases](https://github.com/oramasearch/orama)
- [Browser persistence integration issue](https://github.com/oramasearch/orama/issues/876)
