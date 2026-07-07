# Project Governance

This document defines how architectural decisions, contributions, compatibility and performance are managed as the project evolves.

## Goals

- Preserve architectural consistency.
- Prevent feature creep.
- Keep performance measurable.
- Maintain backward compatibility where practical.
- Ensure every change is justified and documented.

---

# Architecture Decision Records (ADRs)

All significant architectural decisions should be documented as ADRs under `docs/adr/`.

Suggested template:

- Title
- Status
- Context
- Decision
- Alternatives Considered
- Consequences

Create ADRs for decisions such as:

- index format changes
- ranking model changes
- storage abstractions
- compatibility policy
- plugin APIs

---

# Contributor Guidelines

Every contribution should:

- include tests
- preserve deterministic behavior
- avoid unnecessary dependencies
- maintain zero runtime dependencies unless approved
- update documentation when public behavior changes
- consider browser performance and memory usage

Code reviews should verify:

- correctness
- performance impact
- API consistency
- architectural alignment
- documentation
- test coverage

---

# Compatibility Policy

## Public API

Public APIs should remain stable within a major version.

Breaking API changes require:

- documentation
- migration notes
- semantic version bump

## Index Format

Every index format revision should declare:

- supported client versions
- incompatible changes
- migration strategy

Older clients should fail with clear compatibility errors.

---

# Performance Engineering

Performance is treated as a feature.

Every significant change should be evaluated using representative benchmark datasets.

Track:

- index build time
- bundle size
- download size
- first query latency
- warm query latency
- memory usage
- throughput

Performance regressions should be investigated before merging.

---

# Benchmark Policy

Maintain benchmark corpora of increasing size — see
[spec-benchmarking.md](spec-benchmarking.md#corpus-sizes) for the one
authoritative list of recommended sizes and corpus profiles, rather
than a separately-maintained copy here.

Record results over time to detect regressions.

---

# Documentation Policy

Documentation is part of the implementation.

Changes that affect:

- public APIs
- index format
- configuration
- architecture

should update the corresponding documentation in the same change.

---

# Release Quality Checklist

Before a release:

- All tests pass.
- Benchmarks complete without regression.
- Documentation is current.
- Compatibility has been verified.
- Index format changes are documented.
- Changelog is updated.

---

# Guiding Principle

The project should prioritize long-term maintainability over rapid feature growth. New capabilities should strengthen the architecture rather than increase complexity.