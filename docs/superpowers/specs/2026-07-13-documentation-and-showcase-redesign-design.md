# Documentation and showcase redesign

**Status:** Approved design
**Date:** 2026-07-13

## Context

The repository has substantial technical documentation, but its public shape
reflects the order in which ideas were added rather than the paths readers
need. The Pages build currently publishes `README.md` and every top-level
`docs/*.md` file into one flat navigation list. Current guidance, historical
investigations, draft specifications, and planning documents therefore appear
at the same level.

The showcase already proves several features with real generated indexes: site
search, a product catalog, synonym behavior, and internationalized search. The
demos are useful but have no single explanatory landing page, and readers
cannot easily connect a behavior to the minimal code that enables it.

This redesign keeps the custom static site and its real search implementation.
It changes the information architecture, consolidates the content, turns the
showcase into a guided feature gallery, and makes the Pages artifact verifiable
before deployment.

## Goals

- Give new users one clear path from installation to a working first search.
- Organize public documentation by reader intent instead of document age.
- Establish one canonical page for each supported feature or public contract.
- Separate current behavior from future plans and historical investigations.
- Demonstrate supported features with real, interactive examples and matching
  inline source code.
- Make a clean local build equivalent to the GitHub Pages build.
- Fail CI on broken documentation routes, links, assets, or examples.

## Non-goals

- Migrating to VitePress, Docusaurus, or another documentation framework.
- Changing search behavior or public package APIs solely for the demos.
- Publishing internal agent plans and design-session artifacts.
- Preserving the existing numbered documentation URLs with redirects. The
  project has not committed to stable documentation URLs, so repository links
  will be updated to canonical locations instead.
- Replacing the npm publishing workflow. Its existing browser gate will consume
  the improved showcase tests.

## Architecture decision impact

No ADR change is required. The design preserves the accepted pull-based static
HTTP deployment model and the existing custom static-site generator. It adds a
curated content manifest, reusable demo components, and stricter validation
inside those established boundaries; it does not introduce a new durable
platform or reverse an existing architectural decision.

## Audience-first information architecture

Published documentation will use five sections:

```text
docs/
├── getting-started/
│   ├── overview.md
│   ├── installation.md
│   └── first-search.md
├── guides/
│   ├── indexing.md
│   ├── ranking-and-boosts.md
│   ├── facets.md
│   ├── synonyms.md
│   ├── pinning.md
│   ├── internationalization.md
│   ├── offline-search.md
│   └── vector-search.md
├── concepts/
│   ├── architecture.md
│   ├── index-format.md
│   └── binary-storage.md
├── reference/
│   ├── client-api.md
│   ├── configuration.md
│   ├── cms-meta-tags.md
│   └── compatibility.md
├── project/
│   ├── roadmap.md
│   ├── governance.md
│   └── architecture-decisions.md
├── archive/
└── superpowers/
```

`archive/` and `superpowers/` remain versioned but are excluded from the site,
its search index, and link-validation entry points. Architecture Decision
Records remain under `docs/adr/`; `project/architecture-decisions.md` is their
public index and explains the decision process.

The README becomes a concise repository entry point: purpose, capabilities,
short installation example, links to getting started and the showcase, current
project status, and contributor commands. It will no longer duplicate the full
documentation table of contents.

## Content migration policy

Every existing document receives one explicit disposition:

1. **Keep and rewrite** when it is the canonical description of shipped
   behavior.
2. **Merge** when multiple files describe the same user task or decision.
3. **Archive** when the content records a completed investigation, superseded
   plan, or historical review that may still be useful to maintainers.
4. **Remove** only when content is fully duplicated, generated, or superseded
   and has no independent historical value.

The detailed migration matrix will live in the implementation plan. The main
consolidations are fixed by this design:

- `00-overview.md` and the reader-facing parts of the README become the new
  overview, installation, and first-search sequence.
- Ranking, facets, synonyms, pinning, internationalization, offline behavior,
  and vector search each receive one task-oriented guide.
- `01-architecture.md`, `20-tech-stack.md`, `21-architecture-principles.md`,
  and still-current parts of `24-architecture-recommendations.md` become the
  architecture concept and contributor-facing governance material.
- `02-index-format.md`, `11-binary-vs-json-index.md`, and the implemented parts
  of `spec-binary-format.md` become the index-format and binary-storage
  concepts. The completed investigation is archived.
- `09-roadmap.md`, `23-implementation-roadmap.md`, `25-path-to-1.0.md`, and
  unresolved items from recommendations/specifications become one current
  roadmap. Completed phase plans are archived.
- `26-example-configurations.md` becomes the canonical configuration reference,
  with task-specific subsets linked from the guides.
- Active public contracts remain reference material. Unimplemented draft specs
  remain versioned but are moved out of the published reader path until their
  features are current.

Content moves must update repository links in the same change. No published
page may instruct readers to use an API or feature that is only planned.

## Navigation and document discovery

The site generator will discover Markdown recursively but publish only pages
listed in an explicit navigation manifest. The manifest is the source of truth
for section order, page order, routes, and visible titles. A listed source that
does not exist, a duplicated route, or a published source outside an allowed
documentation section is a build error.

The rendered site will provide:

- grouped desktop and mobile navigation;
- an active-page indicator;
- previous/next links within the curated order;
- stable heading anchors;
- accessible code blocks and expandable source regions; and
- links back to the showcase or relevant guide where useful.

Relative Markdown links will continue to work on GitHub. The Pages renderer
will rewrite them to generated HTML routes without assuming the site is hosted
at the domain root.

## Showcase design

The showcase landing page will explain that all results come from the real
indexer and client packages. It will present two levels of examples.

### Quick interactive examples

- Basic full-text search
- Fuzzy matching
- Facet filtering
- Synonym expansion
- Pinned results
- Internationalized search

Each example contains a focused search control, visible results, a short
behavior explanation, a compact syntax-highlighted code sample, an expandable
full configuration/source view, and a link to the canonical guide.

The displayed configuration is imported from or generated from the same typed
definition used to build the example. It must not be a hand-maintained copy
that can drift from runtime behavior.

### Full demonstrations

- Product catalog with facets, boosts, fuzzy matching, and pinning
- Synonym comparison
- Multilingual search
- Search across the documentation site

Existing full demos remain addressable and are linked from the landing page.
Their page shells and navigation will be brought into the common site style.

### Shared demo framework

Quick examples use one reusable widget contract and shared fixtures rather than
independent scripts. Each example definition owns:

- its identifier, title, description, and guide link;
- source documents and index build options;
- initial query and optional controls;
- the minimal code excerpt shown to readers; and
- deterministic assertions used by browser tests.

The build generates each real index and serializes the example metadata needed
by the browser. The client widget loads that metadata, uses `@csf/client` for
queries, and renders consistent accessible states for loading, results, no
results, and errors.

## Build and publishing architecture

The root project exposes a `docs:check` command that represents the complete
documentation gate. A clean checkout can use it to build packages, build the
site, validate generated output, and run the relevant browser tests.

The Pages workflow retains the existing build/upload/deploy structure. Before
uploading `showcase/dist`, it runs the same static validation used locally.
The artifact must be complete and valid before the deployment job begins.

Validation covers:

- all navigation-manifest sources and generated routes;
- internal page, heading, stylesheet, script, and image references;
- unique routes and unique document titles;
- absence of `docs/archive/` and `docs/superpowers/` content from `dist` and the
  search index;
- GitHub Pages subpath-safe URLs;
- consistency between each inline example's displayed code and runtime
  definition; and
- browser interaction for every quick example and every existing full demo.

Package publishing remains independent. Its existing `pnpm test:browser` gate
will exercise the same showcase build, preventing an npm release when the
public examples are broken.

## Error handling

Build-time content errors are fatal and identify the source file or manifest
entry. Runtime example failures render an accessible error message within the
example card and preserve the source code so the page remains explanatory.
They must not break other examples on the page.

The quick-example widget defines explicit states for loading, ready, no
results, and error. Search input is labelled, results updates are announced
without stealing focus, and all filters and source expanders are keyboard
operable.

## Testing strategy

Static tests exercise manifest validation, recursive Markdown rendering, link
rewriting at different nesting depths, archive exclusion, and inline-source
consistency. Fixture-sized tests should fail with precise messages for missing
documents, duplicate routes, and broken links.

Playwright tests cover:

- desktop and mobile navigation;
- a successful query in every quick example;
- fuzzy, facet, synonym, pinning, and multilingual behavior unique to the
  relevant examples;
- source expansion and keyboard interaction;
- loading, no-results, and isolated-error states;
- links from showcase cards to canonical guides; and
- the existing product, synonym, multilingual, and documentation-search demos.

The final verification sequence includes lint, type checking, the focused
static tests, `docs:check`, and the full browser suite. The generated Pages
artifact is also inspected for excluded sources and broken local references.

## Completion criteria

- A new reader can install the packages and complete a first search through one
  uninterrupted documentation path.
- Each supported feature and public configuration has one canonical page.
- Current contracts and future plans are visibly separated.
- The README no longer acts as a second full documentation index.
- The showcase landing page exposes all quick and full examples.
- Every example runs against a real generated index.
- Displayed source is derived from the configuration used at runtime.
- A clean checkout builds the same artifact uploaded by GitHub Actions.
- Broken routes, links, assets, or example behaviors fail before deployment.
- Desktop and mobile browser smoke tests pass.
