# Product specification: client-side search

**Status: proposal — not normative; awaiting requester approval.**
**Version:** 0.1, 2026-11-14.

This is a clean, implementation-independent behavioral specification extracted from the existing Searchable product and extended with expectations of a modern client-side search engine.

| Document | Purpose |
| --- | --- |
| [SYSTEM.md](SYSTEM.md) | Scope, actors, capability contracts, requirements, risks, product decisions |
| [ACCEPTANCE.md](ACCEPTANCE.md) | Technology-independent, requirement-linked acceptance scenarios |
| [GAP-ANALYSIS.md](GAP-ANALYSIS.md) | Grounded feature inventory, observed gaps and proposed dispositions |
| [ORAMA-IMPLEMENTATION-PLAN.md](ORAMA-IMPLEMENTATION-PLAN.md) | Non-normative design for an independent Orama-based candidate |

## Separate authorities

- The **product specification** describes required observable outcomes, independent of Orama, the existing Python/TypeScript algorithms, and the current index representation.
- The existing [implementation model](../system.yaml), [release intake](../INTAKE.md) and [manifest/shard schemas](../schema/) remain the record of **Searchable 2.x**. Their verified statuses and evidence do not certify the proposed replacement.
- The [system-specification metamodel](https://github.com/ktjn/system-specification/blob/main/MODEL-SCOPE.md) supplies the vocabulary: capabilities, contracts, requirements, risks, verification obligations, and evidence. Its reference validator is optional and not the source of product truth.
- Requirements R-xx are **proposed** until the requester approves an explicit version and acceptance baseline. Passing an existing implementation test is not enough to approve a new product obligation.

## Clean-room boundary

The future Orama implementation should be developed in a separate source tree against only the approved product requirements, independently authored corpus fixtures, and independently reviewed black-box acceptance expectations. It must not copy/adapt existing Searchable analysis, index-writing, shard-loading, query, ranking, or caching source code. The current repository is the discovery source, not an implementation blueprint.

This is an **independent reimplementation workflow**, not a claim of formal legal clean-room isolation: the specification author has inspected the source repository. A strict two-team clean room would require an independently isolated implementation team and legal review.

**Compatibility policy:** Preserve user-visible capabilities and documented promises where adopted. Exact BM25F scores, Searchable manifest v2 binary/JSON shape, and existing internal IDs are **not requirements** of a replacement. Maintaining the old public TypeScript/Python APIs or reading manifest v2 would be separate, explicitly approved compatibility scope.

## Approval decisions

Before implementation, approve or amend the following:
1. Define MVP as public, offline-published, browser-local **lexical** search; no query-time API.
2. Decide whether compatibility with Searchable 2.x API and manifest v2 is required; proposed default: **no** for the independent replacement.
3. Approve minimum feature behavior and acceptance cases in [SYSTEM.md](SYSTEM.md) and [ACCEPTANCE.md](ACCEPTANCE.md).
4. Approve the performance, relevance, accessibility and multilingual operating envelope using measured baselines rather than an invented SLA.
5. Decide whether autocomplete and general sort/pagination are MVP requirements; proposed default: **yes**.
6. Keep semantic/vector search, full offline mode, and real-time updates as separately approved features.

No implementation work is authorized by this proposal alone.
