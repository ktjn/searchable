# Tech Stack

Concrete tooling choices for the reference implementation. These are
choices about *this project's* implementation, not the index format's
openness — [02-index-format.md](02-index-format.md#the-format-is-a-spec-not-a-library-dependency)'s
claim that any language with a JSON encoder can produce a conforming
index is unaffected by what this repo happens to build its own
reference implementation in.

## Language: pure TypeScript, no runtime framework

Every package in this repo — `@csf/client` core, every plugin
([17-plugin-architecture.md](17-plugin-architecture.md)), the indexer,
and the showcase — is TypeScript, strict mode, compiled to plain ESM.
No React/Vue/etc. in the runtime or plugins (there was never a reason
to — it's a library, not an app) and none in the showcase shell either,
per [19-github-pages-showcase.md](19-github-pages-showcase.md#non-goals-for-the-showcase)'s
"not framework-heavy" call — the showcase should visibly be a
`<script type=module>` and a search box, not an SPA.

## Build: Vite

One build tool across the whole repo rather than mixing `tsc` for
libraries and something else for the showcase — consistent with the
"simple over clever" principle
([00-overview.md](00-overview.md#guiding-principles)): one tool to
configure, debug, and keep versions in sync for.

- **Packages** (`@csf/client`, each plugin package, `@csf/indexer`):
  built with Vite [library
  mode](https://vite.dev/guide/build.html#library-mode), emitting ESM
  only (no UMD/CJS — every consumer of a browser search library is
  already on ESM-capable tooling, and CJS output would be dead weight
  against the bundle-size budget in
  [08-modern-features.md](08-modern-features.md#bundle-size-budget)).
  Rollup's bundle-size output (Vite's underlying bundler) feeds directly
  into the CI bundle-size gate already specified there.
- **Indexer** (`@csf/indexer`, Node-targeted): also built with Vite
  library mode, targeting Node instead of browser — keeps it on the same
  tool rather than reaching for a separate CLI-bundler; the indexer's
  runtime environment (Node's `fs`, no DOM) is just a different Vite
  build target, not a different toolchain.
- **Showcase** ([19-github-pages-showcase.md](19-github-pages-showcase.md)):
  Vite's [multi-page
  app](https://vite.dev/guide/build.html#multi-page-app) mode — one HTML
  entry per demo page (docs site, docs-search demo, each feature-gallery
  demo), each with its own small TS entry script. Vite's dev server also
  gives the showcase fast local iteration without any custom tooling.

## Testing: Vitest + Playwright, split by what they're good at

Not "pick one test runner" — the two tools cover genuinely different
concerns from [10-testing-and-performance.md](10-testing-and-performance.md),
and using each for what it's actually good at is more accurate than
forcing everything through one:

- **Vitest** — unit tests, golden-file analysis tests, and the
  regression/snapshot suite
  ([10-testing-and-performance.md](10-testing-and-performance.md#1-correctness-tests)):
  pure-function and pure-data-in/data-out tests (tokenizer output,
  BM25F scoring math, synonym expansion, pin conflict resolution) that
  don't need a real DOM, real network, or real Worker to be meaningful.
  Fast, shares config/transform pipeline with Vite (same tool family,
  one less thing to keep in sync), native TS/ESM support.
- **Playwright** — everything that needs a *real* browser environment,
  because Vitest's jsdom/happy-dom environment doesn't have a real
  network stack, real Worker threads, real `Intl.Segmenter` behavior
  differences across engines, or the Long Tasks/Fetch-Priority/Network
  Information APIs at all:
  - End-to-end query behavior against the showcase demo pages (real
    user-facing assertions: type a query, see the right results).
  - Macro-benchmarks in an actual headless browser
    ([10-testing-and-performance.md](10-testing-and-performance.md#2-performance-test-suite) —
    this requirement specifically motivated the tool choice, not the
    other way around).
  - Resource-citizenship checks
    ([18-resource-aware-loading.md](18-resource-aware-loading.md)):
    Long Tasks API assertions, mocked `navigator.connection` via
    Playwright's request interception/context options, Fetch Priority
    hint verification via network-request inspection.
  - Cross-browser matrix (Chromium/Firefox/WebKit) for the specific
    things known to vary — `Intl.Segmenter` locale coverage
    ([03-tokenization-i18n.md](03-tokenization-i18n.md#segmentation)),
    Web Worker behavior, RTL layout rendering.
- **Cross-implementation conformance**
  ([10-testing-and-performance.md](10-testing-and-performance.md#1-correctness-tests)):
  a Vitest test that shells out to the Python reference generator (see
  below) as a subprocess, builds an index from the same fixture corpus,
  and asserts the same query results against both outputs — orchestrated
  from Vitest since the assertions themselves are pure data comparisons,
  even though one side of the comparison is produced by a different
  language's process.

## Reference index generators: Python and TypeScript

[02-index-format.md](02-index-format.md#the-format-is-a-spec-not-a-library-dependency)
commits to `spec/examples/` containing minimal, from-scratch reference
generators proving the format needs no library buy-in. Concretely:

- **`spec/examples/typescript/`** — a minimal generator sharing *no*
  code with the real `@csf/indexer` package (otherwise it wouldn't prove
  anything about the format being independent of this project's own
  tooling) — just the ~50-line tokenize → count → emit-JSON logic
  described in [02-index-format.md](02-index-format.md#the-format-is-a-spec-not-a-library-dependency),
  runnable with `node` and nothing else.
- **`spec/examples/python/`** — the same minimal logic, standard-library
  only (`json`), the genuinely independent proof point: this is the one
  that has to succeed for "the format isn't secretly TypeScript-shaped"
  to be true, since it shares no runtime, no ecosystem, and no author
  assumptions with the rest of the repo.

This narrows [09-roadmap.md](09-roadmap.md) Phase 7's "second/third
reference indexer implementation" language to **Python specifically**
as the initial second implementation (TypeScript is already
implementation #1, built in Phase 1 as the real reference indexer) —
other languages (Java, Go, Rust, etc.) remain valid future community
examples of the same open-format principle
([00-overview.md](00-overview.md#guiding-principles)), just not part of
this project's own initial two.

## Cross-references updated by this decision

- [02-index-format.md](02-index-format.md): reference generator examples
  are Python and TypeScript.
- [09-roadmap.md](09-roadmap.md) Phase 7: second reference implementation
  is Python (not "Python, Java").
- [10-testing-and-performance.md](10-testing-and-performance.md):
  cross-implementation conformance compares the TypeScript reference
  indexer's output against the independent Python example generator's
  output.
