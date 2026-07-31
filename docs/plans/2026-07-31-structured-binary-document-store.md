# Structured Binary Document Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a versioned binary document-store encoding that preserves structured Searchable documents, so RAG indexes can be emitted and consumed as binary by the Python and TypeScript clients.

**Architecture:** Keep the existing directory-based binary doc-store v1 wire format and decoder for legacy `BuiltIndex` documents. Add a structured binary v2 record format selected by the existing `doc_store_format="binary"` option when `build_index_documents()` produces an `IndexDocument`; the manifest declares the per-shard binary version. Python and TypeScript share the same byte-level contract, while the logical `DocStoreEntry` shape remains unchanged for callers.

**Tech Stack:** Python 3.10+, TypeScript, Vitest, pytest, JSON Schema, pnpm, Biome, Playwright, Pyodide-compatible standard-library code.

## Global Constraints

- Preserve byte-for-byte decoding compatibility for existing unstructured binary doc-store v1 shards.
- Preserve all structured document fields: `url`, optional `boost`, optional `externalId`, optional `contentHash`, optional JSON-compatible `metadata`, and stored string fields.
- Encode integers as little-endian unsigned varints and floating-point boosts as little-endian float64, matching the existing binary shard primitives.
- Encode object keys in sorted order and reject non-finite metadata values before encoding so Python and TypeScript produce deterministic logical results.
- Add a magic/version discriminator before structured records; clients must reject unsupported major versions and malformed offsets with a clear error.
- Keep the manifest as the small discovery file; binary document shards remain content-hashed files addressed from `manifest.json`.
- Do not change scoring, query parsing, ranking, vector semantics, or the public `SearchClient`/Python `SearchClient` search result shape.
- Do not touch unrelated untracked files in the source checkout (`.junie/`, caches, or the local Python lockfile).

---

### Task 1: Freeze the structured binary v2 wire contract

**Files:**
- Modify: `docs/archive/specs/binary-format.md`
- Modify: `docs/concepts/index-format.md`
- Modify: `spec/schema/doc-store-shard.schema.json`
- Modify: `packages/format/src/index.ts`
- Test: `packages/format` typecheck and schema validation tests

**Interfaces:**
- Consumes: existing v1 directory/record layout in `python/searchable-indexer/src/searchable_indexer/binary_doc_store.py` and `packages/client/src/binary-doc-store.ts`.
- Produces: a documented structured binary v2 contract and shared `DocStoreEntry` type fields `externalId?: string`, `contentHash?: string`, and `metadata?: Record<string, JsonValue>`.

- [ ] Write the failing format/type tests first.

Add tests that assert the shared type accepts a structured document with:

```ts
const entry: DocStoreEntry = {
  url: "/docs/rag",
  fields: { content: "Evidence" },
  externalId: "docs/rag.md#answer",
  contentHash: "sha256:abc",
  metadata: { headingPath: ["RAG"], chunkIndex: 2 },
};
```

Add schema assertions that the JSON doc-store shape continues to allow the same optional structured properties.

- [ ] Run `pnpm --filter @ktjn/searchable-format typecheck` and confirm the missing type fields or schema expectations fail.

- [ ] Document the exact v2 record layout.

Use this record order, after the existing directory table and records-blob offset:

```text
magic:          four ASCII bytes "SDOC"
version:        unsigned varint 2
url:            length-prefixed UTF-8 string
flags:          unsigned varint
boost:          little-endian float64 when flags bit 0 is set
externalId:     length-prefixed UTF-8 string when flags bit 1 is set
contentHash:    length-prefixed UTF-8 string when flags bit 2 is set
metadata:       tagged JsonValue when flags bit 3 is set
fieldCount:     unsigned varint
fields:         sorted key/value length-prefixed UTF-8 string pairs
```

Define tagged `JsonValue` encoding as: `0=null`, `1=false`, `2=true`, `3=float64`, `4=UTF-8 string`, `5=array followed by count and values`, and `6=object followed by count and sorted UTF-8 key/value pairs`. Require finite numbers and reject unknown tags, truncated values, invalid UTF-8, and lengths outside the input buffer.

Document that the directory retains the existing delta-encoded document IDs and offset/length entries. Add `format: "binary"` and `binaryVersion: 2` to structured doc-shard manifest entries; v1 entries omit `binaryVersion`.

- [ ] Run the format package typecheck and JSON Schema validation after the documentation/type changes.

- [ ] Commit with `git commit -m "docs: specify structured binary doc store"`.

### Task 2: Implement Python structured binary encoding

**Files:**
- Modify: `python/searchable-indexer/src/searchable_indexer/binary_doc_store.py`
- Modify: `python/searchable-indexer/src/searchable_indexer/write_index.py`
- Test: `python/searchable-indexer/tests/test_binary_doc_store.py`
- Test: `python/searchable-indexer/tests/test_write_index.py`

**Interfaces:**
- Consumes: `IndexDocument`-derived structured doc-store entries and the v2 contract from Task 1.
- Produces: `encode_structured_doc_store_binary(shard: dict[str, dict]) -> bytes`; `write_index(..., doc_store_format="binary")` accepts `built.structured` indexes and emits v2 manifest entries.

- [ ] Add failing Python tests for v2 encoding.

Cover one record with every optional field, nested metadata, sorted object keys, deterministic output from different insertion orders, empty metadata/fields, multiple numeric IDs, and non-finite metadata rejection. Assert the first bytes contain `SDOC` and version `2`.

- [ ] Run the focused tests and confirm they fail because structured binary encoding is unavailable and `write_index` still rejects structured indexes.

- [ ] Implement the minimal encoder.

Keep v1 `encode_doc_store_binary()` unchanged. Add small private helpers for optional strings and tagged JSON values; validate metadata recursively before writing. Select the v2 encoder only when `built.structured` is true, leaving legacy indexes on v1. Add `binaryVersion: 2` only to v2 doc-shard manifest objects.

- [ ] Add writer integration assertions.

Build a structured index with `build_index_documents()`, call `write_index(..., doc_store_format="binary")`, load `manifest.json`, and assert the docs shard declares binary v2 and the referenced content-hashed `.bin` file exists. Assert JSON remains the default and v1 output remains unchanged for the legacy builder.

- [ ] Run:

```bash
cd python/searchable-indexer
uv run pytest tests/test_binary_doc_store.py tests/test_write_index.py -q
```

- [ ] Commit with `git commit -m "feat: encode structured documents in binary"`.

### Task 3: Implement Python v2 decoding and client integration

**Files:**
- Modify: `python/searchable-client/src/searchable_client/binary_doc_store.py`
- Modify: `python/searchable-client/src/searchable_client/types.py`
- Modify: `python/searchable-client/src/searchable_client/client.py`
- Test: `python/searchable-client/tests/test_binary_shards.py`
- Test: `python/searchable-client/tests/test_search_binary_index.py`

**Interfaces:**
- Consumes: v1 and v2 manifest entries plus binary bytes emitted by Task 2.
- Produces: `decode_binary_doc_store_entry(...) -> DocStoreEntry` that dispatches by version, returns structured fields, and preserves existing v1 callers.

- [ ] Add failing decoder tests for v2.

Use the Python encoder fixture to test v2 round trips for every optional field, nested arrays/objects, empty values, multiple records, and exact equivalence with the JSON doc store. Add malformed-input tests for bad magic, unsupported version, unknown value tag, truncated string, truncated directory, invalid UTF-8, and out-of-range record offsets.

- [ ] Run the focused Python client tests and confirm v2 decoding fails before implementation.

- [ ] Implement version dispatch and bounds-checked decoding.

Read the v2 magic/version at the record start, decode tagged metadata into Python JSON-compatible values, and populate `DocStoreEntry(external_id=..., metadata=..., content_hash=...)`. Keep v1 decoding behavior and error messages compatible where possible. Ensure `read_bytes()` rejects lengths beyond the buffer rather than returning a short slice.

- [ ] Add an end-to-end Python client test.

Build the same structured index once as JSON and once as binary, search identical queries through both clients, and assert equal hit IDs, scores, URLs, fields, external IDs, metadata, and content hashes.

- [ ] Run:

```bash
cd python/searchable-client
uv run pytest tests/test_binary_shards.py tests/test_search_binary_index.py tests/test_cross_implementation_conformance.py -q
```

- [ ] Commit with `git commit -m "feat: decode structured binary documents in Python"`.

### Task 4: Implement TypeScript v2 decoding and shared-client integration

**Files:**
- Modify: `packages/client/src/binary-doc-store.ts`
- Modify: `packages/client/src/client.ts`
- Modify: `packages/client/src/index.ts`
- Modify: `packages/format/src/index.ts`
- Test: `packages/client/test/binary-doc-store.test.ts`
- Test: `packages/client/test/cross-implementation-conformance.test.ts`

**Interfaces:**
- Consumes: the same v1/v2 manifest and binary bytes as the Python client.
- Produces: TypeScript `DocStoreEntry` values with `externalId`, `contentHash`, and JSON-compatible `metadata`, without changing `Hit` consumers.

- [ ] Add failing TypeScript tests for v2 decoding and structured search results.

Extend the existing real-HTTP JSON-vs-binary test corpus with `externalId`, `contentHash`, and nested metadata. Assert that JSON and binary results are deeply equal for IDs, scores, URL, fields, and structured properties.

- [ ] Add malformed v2 tests.

Cover bad magic/version, truncated directory/record, invalid UTF-8, unknown metadata tag, excessive lengths, and a record offset that exceeds the fetched shard bytes. Assert deterministic thrown errors rather than silent partial records.

- [ ] Implement the TypeScript v2 decoder and client dispatch.

Share the existing `ByteReader`, keep lazy directory parsing and per-hit record decoding, and select v1/v2 from the manifest’s `binaryVersion`. Export only the public structured type additions; keep decoder helpers internal unless existing package conventions require exports.

- [ ] Run:

```bash
pnpm --filter @ktjn/searchable-client exec vitest run test/binary-doc-store.test.ts test/cross-implementation-conformance.test.ts
pnpm --filter @ktjn/searchable-client typecheck
```

- [ ] Commit with `git commit -m "feat: decode structured binary documents in TypeScript"`.

### Task 5: Cross-implementation conformance and Pyodide/browser readiness

**Files:**
- Modify: `python/searchable-client/tests/fixtures/build_index.py`
- Modify: `packages/client/test-support/python-index.ts`
- Create: `spec/fixtures/structured-binary-doc-store/manifest.json`
- Create: `spec/fixtures/structured-binary-doc-store/docs/0.bin`
- Test: `python/searchable-client/tests/test_cross_implementation_conformance.py`
- Test: `packages/client/test/cross-implementation-conformance.test.ts`
- Test: `packages/client/e2e-browser/worker.spec.ts`
- Test: `packages/client/e2e-browser/offline.spec.ts`

**Interfaces:**
- Consumes: the stable v2 binary fixture and both language implementations.
- Produces: checked-in conformance evidence that a binary structured index works over HTTP, in a worker, and from an offline-cached static directory.

- [ ] Generate a deterministic fixture from the Python indexer containing at least two languages, two doc shards, all structured optional fields, and one no-match query corpus. Check in only the manifest and content-hashed binary files, not temporary build directories.

- [ ] Add Python and TypeScript fixture tests.

Both clients must search the same fixture and produce the same normalized results for lexical queries. The normalization must include `id`, `score`, `url`, `fields`, `externalId`, `contentHash`, and `metadata`.

- [ ] Add browser worker coverage.

Serve the fixture from the existing static test server, construct `SearchClient` inside the worker path, and assert the structured fields survive the binary decode. Keep the test independent of network access outside the local fixture server so it remains suitable for a Pyodide/consumer integration.

- [ ] Add offline cache coverage.

Cache the manifest and binary document shard through the existing offline path, reload the client without the network server, and assert the same structured result. Ensure the fixture’s content-hashed paths remain stable.

- [ ] Run:

```bash
pnpm --filter @ktjn/searchable-client exec vitest run test/cross-implementation-conformance.test.ts
pnpm test:browser --grep "structured binary|offline"
```

- [ ] Commit with `git commit -m "test: add structured binary conformance fixture"`.

### Task 6: Documentation, benchmarks, release, and handoff

**Files:**
- Modify: `docs/archive/specs/binary-format.md`
- Modify: `docs/concepts/index-format.md`
- Modify: `docs/project/roadmap.md`
- Modify: `CHANGELOG.md`
- Modify: `python/searchable-indexer/pyproject.toml`
- Modify: `python/searchable-client/pyproject.toml`
- Modify: `packages/client/package.json`
- Modify: `packages/format/package.json`
- Test: existing benchmark and package metadata tests

**Interfaces:**
- Consumes: the released v2 format, conformance fixture, and measured JSON-vs-binary results from Tasks 2–5.
- Produces: consumer-facing format documentation, package version changes, and a release-ready compatibility statement.

- [ ] Document v1/v2 compatibility, the `binaryVersion` manifest field, the preserved structured fields, and the rejection behavior for unsupported versions or corrupt offsets.

- [ ] Add a benchmark comparing structured JSON and binary output size, cold load/parse time, first-hit latency, and memory-relevant decoded bytes for the RAG-shaped corpus. Record the results in the existing benchmark output format; do not claim binary as a default based on a synthetic microbenchmark alone.

- [ ] Update the roadmap and changelog to state that structured binary document shards are available behind `doc_store_format="binary"`; retain JSON as the default until the benchmark evidence supports a default change.

- [ ] Bump package versions according to the repository release policy and update lockfiles only through the package manager. Keep Python and TypeScript format/client releases compatible with the same v2 fixture.

- [ ] Run the complete gates:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:browser
cd python/searchable-indexer && uv run pytest
cd ../searchable-client && uv run pytest
```

- [ ] Run `git diff --check`, inspect the generated fixture, and confirm the source checkout’s unrelated untracked files were not staged.

- [ ] Run the documentation/format review and confirm every changed format/spec reference points to an existing file.

- [ ] Commit with `git commit -m "feat: ship structured binary document store"`.

- [ ] Push the branch and open a draft PR describing v1 compatibility, the v2 structured fields, conformance evidence, benchmark results, and package-version alignment.

## Completion Criteria

- A structured index built by `build_index_documents()` can be written with `doc_store_format="binary"` without losing `externalId`, metadata, `contentHash`, URL, boost, or stored fields.
- Python and TypeScript clients return identical structured hits for the checked-in fixture.
- Existing v1 binary indexes and JSON indexes continue to pass their current tests.
- The binary fixture works through the browser worker and offline cache paths.
- Unsupported or malformed binary data fails closed with deterministic errors.
- Documentation, package versions, changelog, and release notes describe the compatibility boundary accurately.
