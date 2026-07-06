# Binary Index Format Specification

Status: Draft, term/fuzzy/doc-store shards implemented — see
[09-roadmap.md](09-roadmap.md#phase-7--scale-options) and
[11-binary-vs-json-index.md](11-binary-vs-json-index.md) for the shipped
term-shard encoding (`writeIndex(built, outDir, { termShardFormat: "binary" })`,
`packages/indexer/src/binary-term-shard.ts` +
`packages/client/src/binary-term-shard.ts`) and the benchmarks that
validated its directory-based, lazy-per-term-decode design before it was
built, plus the same design applied to fuzzy shards
(`fuzzyShardFormat: "binary"`, `binary-fuzzy-shard.ts`) and a
differently-motivated doc-id-directory encoding for the doc store
(`docStoreFormat: "binary"`, `binary-doc-store.ts`). Facet, synonym, and
pins shards remain JSON — facets deliberately so (see
[02-index-format.md](02-index-format.md#facet-shard): they're usually
decoded in full for aggregate results, the opposite of the access
pattern that makes a binary tier a win elsewhere), synonym/pins because
neither has a demonstrated size problem worth the complexity. This
doc's design for facet/synonym/pins binary encoding is still a draft,
not yet implemented.

## Purpose

The binary index format is an optional compact representation of the same logical index currently represented as JSON. It exists to reduce download size, parse time, memory pressure and query latency for larger corpora.

The binary format is not a replacement for the logical index model. It is a physical encoding.

## Goals

- Preserve the same logical semantics as the JSON format.
- Enable random access to terms, postings, facets and document metadata.
- Reduce transfer size and memory overhead.
- Support forward-compatible versioning.
- Keep decoding simple enough for browser execution.

## Non-goals

The binary format should not:

- change scoring semantics
- introduce a separate query engine
- require WebAssembly for the baseline implementation
- require server-side logic
- require range requests for the initial implementation

## Format Principles

### Little-endian

All numeric values are encoded little-endian unless explicitly stated otherwise.

### Explicit versioning

Every binary file starts with:

- magic bytes
- format version
- section table offset
- flags

### Section based

Files are divided into named sections.

Example sections:

- header
- dictionary
- postings
- field statistics
- document table
- facet table
- string table

### Offset based

Variable-length data is referenced by offsets, not embedded inline in fixed records.

This supports random access and avoids parsing the entire file up front.

## File Types

The format may define several physical files:

- manifest binary metadata
- term dictionary shard
- postings shard
- document store shard
- facet shard
- synonym shard
- pins shard

A deployment may mix JSON and binary files during migration if the manifest declares the format per shard.

## Manifest Integration

The manifest must declare:

- shard format: `json` or `binary`
- binary format version
- file path
- logical shard type
- checksum or content hash
- optional compression

The client must reject unsupported binary versions with a clear compatibility error.

## Dictionary Encoding

The term dictionary should support:

- exact lookup
- prefix range lookup
- deterministic ordering

Possible encodings:

- sorted string table + binary search
- front-coded blocks
- finite state transducer in a later version

Initial recommendation:

- sorted UTF-8 terms
- block index every N terms
- binary search within block

## Posting Encoding

Posting lists should be encoded by document id in ascending order.

Recommended baseline:

- delta encoded document ids
- variable-length integers
- field bitset or field count
- term frequency per field
- position list per field
- optional document boost

Position lists should also use delta encoding.

## Facet Encoding

Facet shards should support:

- terms facets
- range facets
- hierarchy facets

Baseline terms-facet encoding:

- facet value dictionary
- value to document-id list mapping
- document-id lists sorted ascending
- delta encoded ids

## Document Store Encoding

Document store shards should support random access by document id.

Recommended structure:

- doc id table
- offset table
- string table
- stored field records

Stored fields remain UTF-8 strings.

## Compression

Compression should be applied at section or block level, not whole-file level, when random access is required.

Baseline:

- no custom compression beyond HTTP compression

Future options:

- block compression
- varint encoding
- dictionary compression
- front coding

## Checksums

Every binary file should be content-hashed at the deployment level.

Optional internal checksums may be added per section for diagnostics, but are not required in the baseline format.

## Compatibility

Compatibility rules:

- Unknown major version: reject.
- Unknown minor version: allow only if declared compatible.
- Unknown section: skip if marked optional.
- Missing required section: reject.

## Decoding Strategy

The browser runtime should decode lazily.

Do not decode the entire index during initialization.

Recommended strategy:

1. Load manifest.
2. Load dictionary index for matching shard.
3. Resolve query terms.
4. Decode only matching posting lists.
5. Load only document records needed for final hits.

## Security Considerations

The decoder must validate:

- file magic
- version
- section bounds
- offsets
- lengths
- integer overflow
- UTF-8 validity where applicable

Malformed binary data must fail closed with a clear error.

## Testing Requirements

The binary format requires:

- golden binary fixtures
- JSON vs binary result equivalence tests
- corrupted file tests
- boundary offset tests
- compatibility tests
- performance benchmarks

## Success Criteria

Binary and JSON indexes must return identical logical search results for the same corpus, configuration and query.

Binary should only become the default when benchmarks prove it improves at least one of:

- download size
- parse time
- memory usage
- query latency

without unacceptable complexity.