# Showcase: GitHub Pages

A live demo is worth more than the docs for this project specifically,
because GitHub Pages *is* the deployment model being designed for — a
plain static host with no server-side logic. A showcase that actually
works on Pages is a running proof of the core claim in
[00-overview.md](00-overview.md#goals) ("static-hostable index"), not
just an illustration of it.

This plan is staged against the phases in
[09-roadmap.md](09-roadmap.md#phased-build-plan) rather than assuming
the whole engine exists — most of the showcase's *value* (a working
demo, dogfooding the HTML ingestion path) is available well before the
full feature set is built.

## Structure

Two showcase surfaces, published from the same repo:

1. **Docs site** — the `docs/*.md` files in this repo, rendered as
   readable pages with navigation, hosted at the Pages root. Ships now,
   independent of any engine code existing.
2. **Live demo** — one or more small, real, searchable corpora with an
   actual search box wired to the built engine, each demo page focused
   on showcasing a specific capability rather than one undifferentiated
   "kitchen sink" search box. Ships incrementally as each roadmap phase
   lands a capability.

## Stage 0 — Docs site ✅ built

- [`showcase/build-docs.ts`](../showcase/build-docs.ts) renders every
  `docs/*.md` file plus `README.md` to a small static site (landing
  page, one page per doc, an auto-generated nav sidebar in doc order),
  using `marked` for markdown → HTML and a hand-written ~150-line
  template/nav/link-rewriting step — no docs framework, consistent with
  [00-overview.md](00-overview.md#guiding-principles)'s "simple over
  clever." Cross-doc `.md` links are rewritten to the `.html` pages
  this build actually produces.
- This *is* the first real instance of the HTML-ingestion design in
  [14-reference-deployment-cms-2k.md](14-reference-deployment-cms-2k.md#ingestion-from-rendered-html):
  the rendered doc pages are exactly the kind of `<main>`/`<title>`
  structure that adapter expects.
- Deploys via [`.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml)
  (`actions/deploy-pages`) on push to `main` and is live. Enabling Pages
  itself — Settings → Pages → "GitHub Actions" as the source — was a
  one-time repo-settings change outside what a workflow file can do, a
  manual step for whoever administers the repo; it's been done. Getting
  the `deploy` job itself green after that needed one more fix: its
  `environment: {name: github-pages}` block (GitHub's official template)
  requires the deployment-Environments feature, which is a paid-plan
  restriction for *private* repos — it made the job get rejected before
  a runner was ever assigned. `actions/deploy-pages` doesn't need that
  binding to function, so it was dropped.

## Stage 1 — "Search these docs" ✅ built

- [`showcase/build-search.ts`](../showcase/build-search.ts) runs the
  real `@csf/indexer` against Stage 0's rendered HTML output and copies
  the built `@csf/client` bundle alongside it — the actual reference
  indexer and runtime from Phases 0-2, not a mock.
- [`showcase/src/search-widget.ts`](../showcase/src/search-widget.ts) is
  a small (~100 line), unbundled glue script — loaded via a plain
  `<script type="module">` on every page — that constructs a real
  `SearchClient` (Worker execution included) and renders results.
  Verified end-to-end in a real browser via
  [`showcase/e2e-browser/showcase.spec.ts`](../showcase/e2e-browser/showcase.spec.ts),
  including that it works correctly when served from a subpath (as
  GitHub Project Pages does — `user.github.io/<repo>/`, not domain
  root) — every asset/result-link reference is resolved from
  `import.meta.url` (this script's own stable site-root location), not
  a hand-computed page-depth prefix, which was a real bug caught by
  testing at a subpath and not just at server root.
- Dogfooding at the smallest possible scale (22 pages today) turned out
  to be a good stress-test of the "small corpus mode" simplifications
  in [14-reference-deployment-cms-2k.md](14-reference-deployment-cms-2k.md#what-to-simplify-at-this-scale)
  — even smaller than the 2k-doc reference target.
- Not yet done: a Lighthouse/PageSpeed run against a live deployed Pages
  URL to check the resource-aware loading claims in
  [18-resource-aware-loading.md](18-resource-aware-loading.md) — worth
  doing once this is actually deployed, not just built and tested
  locally.

## Stage 2 — Feature gallery (needs Phases 2-5)

A docs search box proves the architecture but doesn't showcase boosts,
facets, synonyms, i18n, or fuzzy matching well — a page of prose doesn't
naturally have categories, prices, or multiple languages. Add a small,
purpose-built demo corpus per feature, each with a short explainer and a
live, editable example:

| Demo | Corpus | Showcases |
|---|---|---|
| Product catalog | ~100-200 synthetic products (name, category, price, tags) | Facets (terms + range), field/doc boosts, `csf-pin` best-bets (e.g. pin "returns policy" to a support page) |
| Synonym playground | A handful of docs with deliberately non-overlapping vocabulary ("couch"-only doc vs. "sofa"-only query) | Synonym expansion, visibly labeled in the UI so the mechanism is legible, not just "it worked" |
| Multi-language corpus | Short parallel articles in English, German, Japanese, Arabic | Language partitioning, `Intl.Segmenter` CJK handling, RTL rendering, per-language stemming differences |
| Typo tolerance | Reuses the product catalog | Fuzzy matching + "did you mean," side-by-side with fuzzy toggled off so the value is visible by comparison |

Each demo is intentionally small and self-contained (not one shared mega
corpus) so a visitor can see *which* feature is responsible for a given
result, rather than one opaque combined index where boosts, synonyms,
and fuzzy all fire on every query and it's unclear which one mattered.

## Stage 3 — Vector/hybrid search (needs Phase 8)

A demo of semantic search on the docs corpus itself is the best fit
here — "search for 'how do I stop the engine from bloating my bundle'"
finding [08-modern-features.md](08-modern-features.md)'s bundle-size
section via meaning rather than exact wording is a legible, honest
demonstration of the feature working, using content that's already
real rather than contrived. Side-by-side lexical vs. hybrid results
(toggle) makes the RRF fusion's effect visible rather than asserted.

## Non-goals for the showcase

- **Not the performance benchmark suite.** [10-testing-and-performance.md](10-testing-and-performance.md)'s
  perf suite runs against synthetic corpora at scale specifically to
  catch regressions before release; the showcase's corpora are small
  and curated for legibility, not scale-testing. A slow showcase and a
  passing perf suite aren't contradictory — they're testing different
  things.
- **Not a marketing site.** No unrelated content, testimonials, or
  design flourishes beyond what's needed to make each demo legible —
  keeps it honest as a technical proof rather than a pitch.
- **Not framework-heavy.** The showcase shell itself should be plain
  HTML/CSS and vanilla JS calling `@csf/client` directly, not a
  React/Vue app — partly to keep it simple, partly because "look, this
  is just a `<script type=module>` tag and a search box" is itself part
  of what the showcase should communicate.

## Deployment mechanics

- [`.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml):
  builds every `packages/*`, then `showcase` (docs → search index →
  copy client bundle), uploads `showcase/dist` as the Pages artifact,
  deploys via `actions/deploy-pages`. Runs on every push to `main`
  (not path-filtered to `docs/**`, since a change to the engine itself
  should also redeploy the demo — the repo is small enough that a full
  rebuild on every push is cheap, same reasoning as the "just rebuild"
  answer to incremental indexing in
  [09-roadmap.md](09-roadmap.md#open-questions)).
- Project Pages are served under `/<repo>/`, not domain root — every
  `indexUrl`/asset/result-link reference in the showcase is resolved
  from `import.meta.url` rather than hardcoded to `/`, and this was
  actually verified by serving a built copy from a subpath in a real
  browser, not just asserted — an earlier version used a hand-computed
  page-depth-relative prefix instead, which looked correct but broke
  because a dynamic `import()` resolves against *its own module's*
  URL, not the page's, catching a real bug testing-at-root alone would
  have missed.
- Same content-hashed shard/manifest versioning as any other deployment
  ([02-index-format.md](02-index-format.md#versioning--cache-strategy))
  — no special-casing for Pages beyond the base-path detail above.
