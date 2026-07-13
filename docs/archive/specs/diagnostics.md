# Diagnostics Specification

Status: Draft — listed in [../roadmaps/specification-roadmap.md](../roadmaps/specification-roadmap.md)'s
Phase 4 and [../roadmaps/architecture-recommendations.md](../roadmaps/architecture-recommendations.md)'s
item 2 (explain API and internal instrumentation, merged into this one
spec) as the spec to write for this; all three now point here rather
than restating its contents.

## Purpose

Diagnostics define how the search engine explains, traces and measures query execution.

Diagnostics are required for:

- ranking debugging
- performance analysis
- storage troubleshooting
- plugin validation
- regression investigation
- production support

Diagnostics must be available without changing query semantics.

## Goals

- Explain why a document matched.
- Explain why a document ranked where it did.
- Measure query execution phases.
- Attribute cost to planner, storage, scoring, facets and plugins.
- Keep overhead predictable.
- Avoid leaking sensitive user data by default.

## Non-goals

Diagnostics should not:

- send data to a remote service by default
- change search results
- require server-side infrastructure
- expose private engine internals as stable public API
- make query execution non-deterministic

## Diagnostic Surfaces

Diagnostics may be exposed through:

- explain API
- query trace object
- timing breakdown
- storage statistics
- plugin diagnostics
- debug logging
- browser performance marks

Each surface has a different stability level.

## Explain API

The Explain API answers why a specific document matched and how its score was produced.

```ts
const explanation = await client.explain("wireless keyboard", docId);
```

Explain output should include:

- normalized query
- analyzed terms
- matched fields
- term frequency
- document frequency
- field length normalization
- field boosts
- term boosts
- document boosts
- pinning information
- final score

## Explain Result Shape

Example shape:

```ts
interface ExplainResult {
  query: string;
  analyzedTerms: string[];
  documentId: number;
  matched: boolean;
  score: number;
  fields: FieldExplanation[];
  boosts: BoostExplanation[];
  pins?: PinExplanation[];
}
```

The exact public shape should remain stable once released.

## Query Trace

A query trace explains how a query was planned and executed.

Trace sections:

- parse
- analyze
- rewrite
- plan
- optimize
- execute
- score
- facets
- load documents

Trace output should be serializable to JSON.

## Timing Model

Every query should be able to report coarse phase timings.

Recommended phases:

- total
- analysis
- planning
- optimization
- storage
- postings decode
- intersection
- scoring
- facets
- document loading
- highlighting
- plugin overhead

Timings should use high-resolution browser timers where available.

## Storage Diagnostics

Storage diagnostics should expose:

- cache hits
- cache misses
- fetch count
- bytes fetched
- failed requests
- retry count
- decode time
- validation failures

Storage diagnostics must not alter caching behavior.

## Planner Diagnostics

Planner diagnostics should expose:

- logical plan
- optimized plan
- optimization rules applied
- estimated cost
- selected operators

This enables validation that the planner optimizes without changing semantics.

## Ranking Diagnostics

Ranking diagnostics should explain:

- BM25 or BM25F components
- idf
- field contribution
- length normalization
- boost multipliers
- tie-breakers

Every ranking plugin must provide equivalent diagnostic output if it replaces core scoring.

## Facet Diagnostics

Facet diagnostics should explain:

- requested facet fields
- active filters
- filter application order
- base candidate set
- contextual count computation

This is necessary because facet bugs are often semantic, not mechanical.

## Worker Diagnostics

When using a Web Worker, diagnostics should include:

- worker initialization time
- message round-trip time
- serialization cost where measurable
- worker failures
- pending request count

Worker diagnostics must not expose internal request ids as stable public API unless explicitly documented.

## Plugin Diagnostics

Plugin diagnostics should attribute:

- plugin name
- plugin version
- lifecycle phase
- execution time
- output changes
- errors

A plugin must not silently modify query behavior without traceability.

## Logging

Logging should be opt-in.

Default behavior:

- no console logging during normal operation
- typed errors for failures
- diagnostics available through explicit APIs

Debug logging may be enabled through configuration.

## Privacy

Diagnostics may include user queries and matched document content.

Rules:

- diagnostics stay local by default
- no remote transmission in core
- applications decide whether to export telemetry
- sensitive fields should be redacted where configured

## Error Reporting

Errors should include:

- type
- message
- phase
- cause where available
- relevant shard or plugin name where applicable

Errors should avoid dumping full user queries or document contents unless diagnostics are explicitly enabled.

## Performance Overhead

Diagnostics must have predictable overhead.

Modes:

- off: minimal overhead
- timings: coarse timings only
- trace: structured execution trace
- explain: per-document scoring explanation

The default mode is off or timings-only, depending on API maturity.

## Browser Performance API

Optional integration:

- `performance.mark()`
- `performance.measure()`

This should be opt-in to avoid polluting application performance timelines.

## Test Requirements

Diagnostics require tests for:

- explain correctness
- timing presence
- no behavior changes when diagnostics enabled
- plugin attribution
- worker diagnostics
- redaction
- error typing
- JSON serializability

## Success Criteria

Diagnostics succeed when a developer can answer:

- why did this document match?
- why did this document rank above another?
- which phase was slow?
- which shard was loaded?
- which plugin changed the query?
- why did execution fail?

without modifying the core engine or reproducing the issue with ad-hoc logging.