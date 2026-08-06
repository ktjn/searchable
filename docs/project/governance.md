# Project governance

This page defines how maintainers make decisions, preserve compatibility, verify changes, and manage performance and releases.

## Decisions and contributions

Architecture changes require an ADR with status, context, decision, alternatives, and consequences. Small implementation choices belong in code and tests. Contributions should solve a concrete consumer problem, keep the public API small, preserve deterministic output, and avoid runtime dependencies unless their cost is explicitly opt-in.

The accepted ADR index is [Architecture decisions](architecture-decisions.md). Draft designs do not become commitments merely because they are archived.

## Compatibility

When published, the four public npm packages follow semver and move in lockstep. The manifest format uses its own integer version and compatibility table; see [Compatibility](../reference/compatibility.md). Breaking API or format changes require migration documentation and focused compatibility tests.

## Testing

Behavior changes require unit or integration coverage at the narrowest useful level, plus cross-package or browser coverage when they cross a boundary. Index-format changes require schema validation, cross-implementation conformance (the real `python/searchable-indexer` against the independent reference generator in `spec/examples/python/`), malformed-input tests, and JSON/binary parity where applicable. Ranking changes require snapshot review against the configuration testbed.

CI gates include build, Vitest, Python tests, TypeScript type checking, Biome, browser tests, bundle size, and package consumer fixtures. Documentation examples must use exported symbols and current option names.

## Performance policy

Measure before changing storage or loading architecture. Benchmarks must state corpus, query set, browser/runtime, cold or warm state, output size, timing method, and repeat count. Keep correctness coupled to performance work: an optimization is not accepted if it changes results without an explicit product decision.

The core client, worker, and Service Worker share a 15 KB gzip budget enforced by `pnpm size`. Large optional dependencies must stay lazy and external to that core budget.

## Release checklist

Repository visibility and its post-public security settings are tracked in the
[Public launch checklist](public-launch-checklist.md). Package publication is a
separate release operation.

- public exports and docs agree;
- package and format compatibility are explicit;
- changelog and migration notes are current;
- build, tests, type checks, lint, browser checks, and size gates pass;
- package artifacts and consumer fixtures are verified;
- Python artifacts pass the isolated release-artifact smoke test
  (`.github/workflows/publish.yml`): the built `dist/` alone must resolve
  every inter-package dependency and survive a minimal index-build and
  client-read run;
- roadmap status distinguishes shipped work from proposals.

PyPI publishing authenticates with `PYPI_API_TOKEN`. Migrating to trusted
publishing (OIDC) is the intended direction: it removes the long-lived token
in favor of short-lived credentials, but requires a trusted publisher mapping
for this repository's `pypi` environment on the PyPI side first, so until that
mapping exists the token flow remains the operative release path.
