# Implementation Roadmap

**Relationship to [09-roadmap.md](09-roadmap.md)**: the "Phase 1-4" below
is a *specification-writing* sequence (which design docs to write next),
a different axis from 09-roadmap.md's "Phase 0-8", which tracks actual
*build* status (what has working code vs. what's design-only) and is
the canonical source for "is X done." A doc phase and a build phase
with the same number here are coincidental, not the same milestone —
e.g. this doc's "Phase 1" (binary format / query planner / storage
specs) has no fixed correspondence to 09-roadmap.md's Phase 1 (the
minimal viable engine, long since built).

This document identifies the remaining major technical specifications that should be written before the project reaches a stable 1.0 architecture.

## Objective

Keep implementation aligned with well-defined specifications rather than allowing architecture to emerge from incremental feature work.

## Phase 1 – Core Specifications

### Binary Index Format

Define:

- binary layout
- versioning
- endianness
- compression strategy
- random access
- compatibility guarantees

### Query Planner

Specify:

- logical query tree
- execution plan
- optimization passes
- cost model
- execution interfaces

### Storage Layer

Specify:

- storage interfaces
- cache responsibilities
- offline support
- transport independence

## Phase 2 – Extensibility

### Plugin API

Specify extension points for:

- analyzers
- ranking
- storage
- highlighting
- facets
- query rewriting

Define lifecycle, registration and compatibility rules.

### Ranking Framework

Document how multiple ranking strategies can coexist while preserving deterministic ordering.

## Phase 3 – Performance

### Benchmark Methodology

Specify:

- datasets
- hardware assumptions
- browser versions
- warm vs cold measurements
- reporting format

### Memory Model

Document expected allocation strategy, cache ownership and object lifetime.

## Phase 4 – Operational Features

### Diagnostics

Specify explain APIs, tracing, metrics and profiling hooks.

### Compatibility Matrix

Maintain compatibility tables between:

- client versions
- index versions
- plugin versions

## Success Criteria

The implementation should always follow an approved specification. Significant architectural work should begin with documentation and design before code changes are introduced.