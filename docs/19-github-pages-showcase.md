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

## Stage 0 — Docs site (buildable today, no engine code needed)

- Render `docs/*.md` to a small static site: a landing page (adapted
  from `README.md`), one page per doc, a nav sidebar in doc order.
  Deliberately simple tooling — a small static-site step (even a script
  that wraps each markdown file in a shared HTML template) rather than
  pulling in a full docs framework, consistent with
  [00-overview.md](00-overview.md#guiding-principles)'s "simple over
  clever."
- This *is* the first real instance of the HTML-ingestion design in
  [14-reference-deployment-cms-2k.md](14-reference-deployment-cms-2k.md#ingestion-from-rendered-html):
  the rendered doc pages are exactly the kind of `<main>`/`<title>`
  structure that adapter expects, so building this site now produces
  the fixture the engine will eventually index in Stage 1 — not
  throwaway scaffolding.
- Deploy via GitHub Actions → GitHub Pages (`actions/deploy-pages`),
  triggered on push to `main` touching `docs/**`. (Enabling Pages itself
  — Settings → Pages → "GitHub Actions" as the source — is a one-time
  repo-settings change outside what a workflow file can do; that's a
  manual step for whoever administers the repo.)

## Stage 1 — "Search these docs" (needs Phase 1 MVP)

- Once the reference indexer and minimal browser runtime exist
  ([09-roadmap.md](09-roadmap.md) Phase 1), point the indexer at the
  Stage 0 docs site's rendered output and publish the resulting shards
  alongside it.
- A search box on every docs page, wired to `@csf/client`, replacing
  (or augmenting) GitHub's own file browser as the way to find content
  in this repo — dogfooding at the smallest possible scale (~19 doc
  pages today), which is a good stress-test of the "small corpus mode"
  simplifications in
  [14-reference-deployment-cms-2k.md](14-reference-deployment-cms-2k.md#what-to-simplify-at-this-scale)
  (even smaller than the 2k-doc reference target, so if sharding-related
  complexity ever leaks into a deployment this size, it's a bug).
- This is also the natural place to prove the resource-aware loading
  claims in [18-resource-aware-loading.md](18-resource-aware-loading.md)
  — a real Lighthouse/PageSpeed run against a live Pages URL is a much
  more convincing check than a synthetic benchmark alone.

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

- One GitHub Actions workflow: build docs site → (once available) run
  the reference indexer against it → run the feature-gallery build
  (separate small script generating the synthetic corpora + running the
  indexer against each) → upload combined artifact → `deploy-pages`.
- Project Pages are served under `/<repo>/`, not domain root — every
  `indexUrl`/asset reference in the showcase must be relative or use
  the repo's base path, not hardcoded to `/`; worth a build-time check
  (broken-link/broken-manifest-URL check) rather than discovering it
  after a deploy.
- Same content-hashed shard/manifest versioning as any other deployment
  ([02-index-format.md](02-index-format.md#versioning--cache-strategy))
  — no special-casing for Pages beyond the base-path detail above.
