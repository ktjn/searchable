# Section-Level HTML Indexing

## Status

Proposed

## Summary

Searchable currently indexes one searchable document per HTML page. This works well for general websites but is suboptimal for documentation sites where individual pages may contain many independently useful sections.

Add optional section-level HTML indexing. When enabled, the HTML indexer splits a page into searchable documents based on heading boundaries and links results directly to the corresponding heading anchor.

The feature must remain framework-agnostic. It must not depend on MkDocs, Markdown, or any specific documentation generator.

## Goals

- Support heading-level search results for documentation sites.
- Return URLs pointing directly to section anchors.
- Preserve page-level context such as the document title.
- Support configurable heading levels.
- Preserve existing page-level indexing as the default.
- Keep extraction deterministic.
- Work with ordinary rendered HTML.
- Avoid coupling Searchable to MkDocs or other site generators.

## Non-Goals

- Parsing Markdown.
- Understanding MkDocs navigation or configuration.
- Generating heading IDs.
- Modifying source HTML.
- Building hierarchical navigation.
- Automatically deciding which headings are semantically important.
- Changing the `SearchClient` query API.
- Replacing existing page-level indexing.

## Motivation

Consider a documentation page:

```html
<main>
  <h1>Transactions</h1>

  <h2 id="transaction-model">Transaction Model</h2>
  <p>...</p>

  <h2 id="commit-protocol">Commit Protocol</h2>
  <p>...</p>

  <h2 id="effects">Effects</h2>
  <p>...</p>
</main>
```

Today this produces one searchable document:

```text
Transactions
/docs/transactions/
```

A search for `commit protocol` therefore returns the page rather than the relevant section.

With section indexing enabled, Searchable should additionally or alternatively produce:

```text
Transaction Model
/docs/transactions/#transaction-model

Commit Protocol
/docs/transactions/#commit-protocol

Effects
/docs/transactions/#effects
```

This improves precision for long technical documentation pages. Scalable is a useful reference consumer because its documentation contains long specifications, ADRs, architecture documents, and stable heading anchors.

## Configuration

Section indexing must be opt-in.

Example CLI:

```bash
searchable-indexer ./site ./site/search-index \
  --sections h2,h3
```

Equivalent programmatic configuration:

```python
build_index(
    sources,
    section_indexing={
        "selectors": ["h2", "h3"],
    },
)
```

Exact public API naming may follow existing Searchable conventions.

### Default

```text
section indexing disabled
```

Existing consumers must observe no behavioral change.

## Extraction Model

When section indexing is disabled:

```text
HTML page
  -> one Searchable document
```

When enabled:

```text
HTML page
  -> page extraction
  -> section discovery
  -> one Searchable document per eligible section
```

Each section document should contain:

```text
title
pageTitle
body
url
language
boost
facets
rangeFacets
metadata
```

Conceptually:

```python
SectionDocument(
    title="Commit Protocol",
    page_title="Transactions",
    body="...",
    url="/docs/transactions/#commit-protocol",
)
```

## Section Boundaries

Configured heading selectors define section starts.

For:

```text
selectors = ["h2", "h3"]
```

the following document:

```html
<h2 id="a">A</h2>
<p>A1</p>

<h3 id="a-1">A.1</h3>
<p>A2</p>

<h3 id="a-2">A.2</h3>
<p>A3</p>

<h2 id="b">B</h2>
<p>B1</p>
```

should produce:

```text
A
  body: A1

A.1
  body: A2

A.2
  body: A3

B
  body: B1
```

A section ends at the next configured heading of the same or higher hierarchy level.

Content belonging to nested configured sections must not be duplicated into the parent section. This avoids large parent sections dominating ranking merely because they contain all nested text.

## Heading Hierarchy

Heading hierarchy must follow HTML heading levels rather than selector order.

Example:

```text
h2 > h3 > h4
```

If selectors are:

```text
h2,h4
```

then an `h4` section ends when the next selected `h4` or `h2` begins.

Unselected headings do not create documents.

## Anchors

A section is independently indexable only when its heading has a usable `id`.

Example:

```html
<h2 id="commit-protocol">Commit Protocol</h2>
```

produces:

```text
/docs/transactions/#commit-protocol
```

Searchable must not invent heading IDs.

If an eligible heading has no `id`, skip section indexing for that heading. This guarantees that every section result navigates directly to the indexed content.

A warning should be emitted when a configured heading cannot be indexed because its anchor is missing.

## Canonical URLs

Section URLs must be derived from the already-sanitized page canonical URL.

Given:

```text
canonical page URL:
/docs/transactions/
```

and:

```html
<h2 id="effects">
```

the section URL becomes:

```text
/docs/transactions/#effects
```

Existing canonical URL protocol and allowed-origin protections must continue to apply.

The heading ID must only become the URL fragment. It must not influence origin or path resolution.

## Titles

For section documents:

```text
title = heading text
pageTitle = HTML <title> or page-level title
```

Example:

```text
title: Commit Protocol
pageTitle: Transactions
```

The section title should be independently indexable and stored.

The page title should remain available for ranking and result presentation.

A default field model could be:

```text
title       boost 3.0
pageTitle   boost 1.5
body        boost 1.0
```

Exact default boosts should be benchmarked using the relevance corpus rather than treated as normative.

## Page-Level Document

Two operating modes should be considered.

### Sections only

```text
page -> section documents
```

### Page and sections

```text
page -> page document + section documents
```

Recommended default when section indexing is enabled:

```text
sections only when eligible sections exist
page document otherwise
```

This minimizes duplicate results for the same page.

An explicit configuration option may support indexing both.

## Content Before First Section

Content before the first configured heading must not be silently lost.

Example:

```html
<h1>Transactions</h1>
<p>Overview text...</p>

<h2 id="model">Model</h2>
```

Recommended behavior:

- if the page document is retained, the introductory content belongs to it;
- if using sections-only mode, create an optional synthetic page-introduction document using the page URL.

The initial implementation may instead retain a page-level document whenever meaningful pre-section content exists.

The behavior must be deterministic and documented.

## Existing Extraction Rules

Existing HTML extraction behavior continues to apply before section processing.

This includes:

- `data-searchable-body`;
- `<main>` fallback;
- `<body>` fallback;
- `data-searchable-ignore`;
- removal of structural boilerplate;
- `searchable-noindex`;
- canonical URL handling;
- language detection;
- document boosts;
- facets;
- range facets;
- pins.

A page marked:

```html
<meta name="searchable-noindex">
```

must produce no page or section documents.

Ignored content must not appear in section bodies.

## Metadata

Section documents should expose generic metadata describing their origin.

Recommended metadata:

```json
{
  "documentType": "section",
  "pageTitle": "Transactions",
  "headingLevel": 2,
  "anchor": "commit-protocol"
}
```

Page-level documents may expose:

```json
{
  "documentType": "page"
}
```

These fields should use the existing structured document metadata mechanism where possible.

Do not add framework-specific metadata such as:

```text
mkdocsPage
mkdocsSection
```

## Generic HTML Metadata

Separately from section indexing, Searchable should support optional stored metadata declared in HTML.

Example:

```html
<meta name="searchable-meta-type" content="specification">
<meta name="searchable-meta-area" content="transactions">
```

produces:

```json
{
  "type": "specification",
  "area": "transactions"
}
```

This metadata should be stored with the document but not indexed unless explicitly configured as an indexed field or facet.

Section documents inherit page-level metadata.

This capability enables result rendering such as:

```text
SPECIFICATION · Transactions

Commit Protocol
Defines the transaction commit protocol...
```

without deriving semantics from URLs.

### Security

Metadata parsing must:

- accept only valid Searchable metadata names;
- treat values as plain text;
- never execute HTML or script content;
- preserve existing URL sanitization rules;
- avoid exposing arbitrary DOM attributes automatically.

## Result Model

No new `SearchClient` operation is required.

Existing hits should continue to use the existing result model. Section-specific information is returned through stored fields or metadata.

Example:

```ts
{
  id: 42,
  score: 7.81,
  url: "/docs/transactions/#commit-protocol",
  fields: {
    title: "Commit Protocol",
    pageTitle: "Transactions",
    body: "..."
  },
  metadata: {
    documentType: "section",
    headingLevel: 2,
    anchor: "commit-protocol"
  }
}
```

If metadata is not currently exposed by the TypeScript hit API, exposing stored structured metadata should be handled consistently with the existing index document model.

## Ranking

Section indexing must not require a new ranking model.

Existing BM25F behavior should remain applicable.

Important ranking considerations:

- heading text should have stronger weight than body text;
- page title should provide useful context but not dominate the section heading;
- document length normalization should operate on the section body rather than the complete page;
- duplicate parent/child content should be avoided.

The last point is critical. Duplicating nested content into parent sections would distort BM25F document length and term frequency.

## Highlighting

Existing highlighting should work against section fields without changes to query syntax.

When a section result matches body text, highlighting should be scoped to that section rather than the entire source page.

## Pins

Page-level pin metadata should apply to the page document.

Section inheritance of pins should not occur automatically. Otherwise one page pin could create several pinned results.

Future section-specific pinning could be supported through HTML annotations but is outside this specification.

## Facets

Page-level terms and hierarchical facets should be inherited by section documents.

Example:

```html
<meta name="searchable-facet-type" content="specification">
```

All sections from that page should receive:

```text
type = specification
```

This allows filtering without requiring repeated metadata for every section.

Range facets follow the same inheritance rule.

## Boosts

Page-level `searchable-boost` should be inherited by section documents.

Future section-specific boost controls are outside this specification.

## Language

All sections inherit the page's resolved language.

Language detection must not run independently for every section.

Reasons:

- consistency;
- deterministic analysis;
- short sections may not contain enough text for reliable detection.

## Index IDs

Section documents require stable unique IDs.

IDs must remain deterministic for unchanged input.

The implementation should derive section identity from stable input such as:

```text
canonical URL + heading anchor
```

rather than DOM position alone.

A heading moving within a page should ideally retain the same logical identity if its canonical URL and anchor remain unchanged.

## Duplicate Anchors

HTML containing duplicate heading IDs is invalid for reliable section navigation.

Searchable should detect duplicate section URLs within a page.

Recommended behavior:

- index the first section;
- skip later duplicates;
- emit a warning.

Do not silently create multiple documents with the same URL.

## Empty Sections

Sections containing no meaningful body text may still be useful if their heading is searchable.

Recommended behavior:

- index sections with a non-empty heading even when body is empty;
- allow normal ranking to determine their usefulness.

Sections with neither usable heading text nor body content must be skipped.

## Performance

Section indexing increases logical document count.

For documentation corpora this is expected to remain manageable.

Example:

```text
100 pages
10 sections/page
≈ 1,000 documents
```

No new storage architecture is required.

Existing sharding, binary storage, caching, workers, and query execution must continue to work unchanged.

## Backward Compatibility

This feature must be fully backward compatible.

Without section configuration:

```text
output before feature == output after feature
```

Existing manifest and client compatibility guarantees must remain intact unless a format change is explicitly required.

Prefer representing sections as ordinary index documents so no new client/index format version is necessary.

## CLI Example

```bash
searchable-indexer \
  ./site \
  ./site/search-index \
  --sections h2,h3
```

Expected result:

```text
[indexer] indexed 38 pages
[indexer] created 214 section documents
[indexer] skipped 3 headings without anchors
```

Exact logging format is non-normative.

## Programmatic Example

Conceptually:

```python
build_index(
    sources,
    default_language="en",
    section_indexing={
        "selectors": ["h2", "h3"],
        "mode": "sections",
    },
)
```

Potential configuration model:

```python
@dataclass(frozen=True)
class SectionIndexingConfig:
    selectors: tuple[str, ...] = ("h2", "h3")
    mode: Literal["sections", "page-and-sections"] = "sections"
```

The concrete API should follow existing Searchable naming conventions.

## Test Requirements

Add extraction tests covering:

1. section indexing disabled;
2. simple `h2` sections;
3. mixed `h2`/`h3` hierarchy;
4. unselected headings;
5. sections with nested HTML;
6. headings without IDs;
7. duplicate IDs;
8. ignored elements inside sections;
9. canonical URLs with anchors;
10. unsafe canonical URLs;
11. `searchable-noindex`;
12. inherited boosts;
13. inherited facets;
14. inherited range facets;
15. inherited metadata;
16. language inheritance;
17. empty sections;
18. content before the first section;
19. stable document IDs;
20. HTML entities and Unicode headings.

Add end-to-end relevance cases where a term occurring in one section returns that section rather than only the containing page.

## Acceptance Criteria

The feature is complete when:

- section indexing is explicitly configurable;
- existing page indexing remains unchanged by default;
- configured headings generate independently searchable documents;
- section result URLs contain the existing heading anchors;
- nested section content is not duplicated into parent sections;
- page title context is retained;
- language, facets, range facets, boosts, and generic metadata are inherited appropriately;
- `searchable-noindex` suppresses all derived section documents;
- missing or duplicate anchors produce deterministic behavior and diagnostics;
- `SearchClient` requires no section-specific query API;
- existing lexical, fuzzy, synonym, highlighting, facet, worker, offline, binary, vector, and hybrid functionality continues to operate on section documents;
- tests demonstrate improved documentation-search relevance.

## Future Work

Potential follow-ups:

- section-specific boosts;
- section-specific pins;
- configurable result grouping by source page;
- collapse multiple results from the same page;
- breadcrumb extraction;
- heading hierarchy stored as metadata;
- heading-aware excerpts;
- automatic relevance benchmarks against real documentation corpora.

These are not required for the initial implementation.
