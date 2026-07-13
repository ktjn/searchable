# Query Planner Specification

Status: Draft — listed in [../roadmaps/specification-roadmap.md](../roadmaps/specification-roadmap.md)'s
Phase 1 and [../roadmaps/architecture-recommendations.md](../roadmaps/architecture-recommendations.md)'s
item 1 as the spec to write for this; both now point here rather than
restating its contents.

## Purpose

The query planner is responsible for transforming a parsed query into an optimized execution plan. The execution engine must never execute directly against the parsed syntax tree.

Pipeline:

Query
→ Parse
→ Analyze
→ Rewrite
→ Plan
→ Optimize
→ Execute

## Goals

- Separate planning from execution.
- Keep execution deterministic.
- Allow new query features without rewriting the executor.
- Support future optimizations.

## Responsibilities

The planner:

- resolves fields
- expands synonyms
- applies boosts
- normalizes filters
- validates the query
- estimates execution cost
- selects execution operators

The executor:

- fetches shards
- executes operators
- scores
- computes facets
- loads documents

## Logical Plan

The planner produces a tree of logical operators.

Examples:

- Term
- Phrase
- Prefix
- And
- Or
- Not
- Filter
- Boost
- MatchAll

Logical plans are storage-independent.

## Physical Plan

The optimizer converts logical operators into executable operators.

Examples:

- FetchPostingList
- Intersect
- Union
- Difference
- Score
- ComputeFacets
- LoadDocuments

## Optimization Rules

Potential optimization passes:

- reorder intersections by posting-list size
- eliminate duplicate terms
- collapse nested boolean operators
- remove impossible branches
- push filters early
- merge adjacent operations

Optimization must never change query semantics.

## Explain Support

Execution plans should be serializable for diagnostics.

Explain output should include:

- logical plan
- optimized plan
- timing
- estimated cost
- actual cost

## Extensibility

Future query types should only require:

- parser support
- planner rule
- execution operator

Existing operators should remain unchanged whenever possible.

## Non-goals

The planner should not:

- access storage
- fetch shards
- score documents
- compute facets

Those responsibilities belong to execution.

## Success Criteria

Every supported query must produce a deterministic execution plan independent of storage implementation.