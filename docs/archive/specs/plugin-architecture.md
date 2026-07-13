# Plugin Architecture

Earlier docs refer to fuzzy matching, synonyms, facets, vector search,
pins, highlighting, and per-language stemmers as "opt-in plugins," but
that was a naming convention, not a contract. This doc specifies the
actual mechanism: what a plugin is, how it registers, what it can hook
into, and how core stays entirely ignorant of which plugins exist —
because "modular and pluggable" has to mean a real interface boundary,
not just optional npm packages that happen to get imported conditionally.

There are **two separate plugin systems** — indexer (build-time) and
runtime (query-time) — because they run in different processes, have
different lifecycles, and shouldn't share a dependency graph (a
deployment's browser bundle must never pull in indexer-only code).

## Design rules

- **Core defines hooks; it never imports a plugin.** Every optional
  capability attaches to a named extension point in core's pipeline.
  Core has no `if (fuzzyEnabled)` branches anywhere — if no plugin
  registers for a hook, that stage is simply a no-op pass-through.
- **Plugins don't know about each other.** A plugin sees only the
  `PluginContext` core hands it and the hook stage it registered for —
  it cannot reach into another plugin's state. Cross-plugin
  interactions (e.g. pins deferring to an active facet filter,
  [16-term-to-page-pinning.md](../../guides/pinning.md#what-happens-at-query-time))
  happen because both plugins read the same core-owned pipeline state
  (the candidate doc-id set), not because they call each other directly.
- **A plugin is independently testable.** Every plugin ships with its
  own unit tests against a mocked `PluginContext`, per the "done" bar
  in [10-testing-and-performance.md](../../project/governance.md) —
  if a plugin can't be tested without booting the whole engine, its
  boundary is drawn wrong.
- **No dependency-injection framework.** Registration is a plain array
  of factory calls the caller writes out explicitly
  (`plugins: [fuzzy(), facets(['category'])]`) — matches the "simple
  over clever" principle in
  [00-overview.md](../../getting-started/overview.md); a DI container
  would be solving a problem this project doesn't have.

## Runtime plugin contract

```ts
interface RuntimePlugin {
  name: string;
  apiVersion: string;          // checked against core's supported range at registration
  install(ctx: RuntimePluginContext): void;
}

interface RuntimePluginContext {
  manifest: Manifest;
  fetchShard(path: string): Promise<unknown>;   // routed through the shared LRU cache
  hooks: {
    analyzeQuery: HookRegistry<AnalyzeQueryHook>;    // tokenize/normalize the raw query
    expandQuery: HookRegistry<ExpandQueryHook>;      // synonyms taps here
    planFetch: HookRegistry<PlanFetchHook>;          // decide which extra shards a query needs
    score: HookRegistry<ScoreHook>;                  // fuzzy penalty, vector RRF merge
    filter: HookRegistry<FilterHook>;                // facet-based candidate-set narrowing
    assembleResults: HookRegistry<AssembleResultsHook>; // pin insertion, highlighting
  };
}
```

Core runs these six stages **in a fixed, documented order** for every
query — `analyzeQuery → expandQuery → planFetch → score → filter →
assembleResults` — and each stage runs every plugin registered for it
in registration order. This fixed order is itself part of the contract
(not an implementation detail) since e.g. pins must run after scoring/
filtering to know the final candidate set, and fuzzy must run after
exact matching to apply its score penalty relative to it
([04-query-ranking-boosts.md](../../guides/ranking-and-boosts.md)).

### Which existing feature is which plugin

| Plugin | Hook(s) used | Doc |
|---|---|---|
| `fuzzy()` | `score` | [04](../../guides/ranking-and-boosts.md) |
| `synonyms()` | `expandQuery` | [../../guides/synonyms.md](../../guides/synonyms.md) |
| `facets(fields)` | `filter` | [../../guides/facets.md](../../guides/facets.md) |
| `pins()` | `assembleResults` | [../../guides/pinning.md](../../guides/pinning.md) |
| `highlight()` | `assembleResults` | [08-modern-features.md](../../concepts/architecture.md) |
| `vector()` | `planFetch`, `score` | [../../guides/vector-search.md](../../guides/vector-search.md) |
| `lang(code)` | `analyzeQuery` (registers a `LanguageProfile` for that language) | [../../guides/internationalization.md](../../guides/internationalization.md) |
| `wasmCore()` | replaces the default JS implementation of `score`'s built-in lexical step, rather than adding a new one | [08-modern-features.md](../../concepts/architecture.md) |

None of these plugins are special-cased in core — the table exists so
this doc, not core's source, is the map from "feature" to "hook," which
is exactly the property that keeps core from needing to know they exist.

### Registration

```ts
import { SearchClient } from "@ktjn/searchable-client";
import { fuzzy } from "@ktjn/searchable-plugin-fuzzy";
import { synonyms } from "@ktjn/searchable-plugin-synonyms";
import { facets } from "@ktjn/searchable-plugin-facets";
import { pins } from "@ktjn/searchable-plugin-pins";
import { lang } from "@ktjn/searchable-plugin-lang-ja";

const client = new SearchClient({
  indexUrl: "https://cdn.example.com/search-index/manifest.json",
  plugins: [fuzzy(), synonyms(), facets(["category", "tags"]), pins(), lang()],
});
```

Each plugin is its own npm package specifically so an unused plugin
never enters the dependency graph at all (not just "tree-shaken out" —
never installed), which is the strongest version of the bundle-size
budget already committed to in
[08-modern-features.md](../../concepts/architecture.md).

### Capability negotiation

The manifest declares which optional shard types the index actually has
(`facets`, `synonyms`, `pins`, `vectors` — see
[02-index-format.md](../../concepts/index-format.md#manifest)). At init, core
checks that declaration against the registered plugin set:

- Manifest has a shard type with **no corresponding plugin registered**
  → a `console.warn` by default ("this index has facet data but no
  `facets()` plugin is registered — facet filtering will be a no-op"),
  or a thrown `MissingPluginError` if the caller opts into strict mode
  (`strict: true`) — same soft/strict pattern already established for
  fetch errors in
  [07-client-api.md](../../reference/client-api.md), so
  there's one consistent policy knob for "index/config mismatch"
  problems rather than a different one per feature.
- Plugin registered with **no corresponding manifest shard** (e.g.
  `vector()` registered against an index with no vector shards) → not
  an error, just a no-op for that plugin — a deployment might register
  plugins generically across multiple indexes with different feature
  sets (see federated search,
  [07-client-api.md](../../reference/client-api.md)),
  and forcing every index to support every registered plugin would
  defeat that.

## Indexer plugin contract

Separate interface, separate packages, runs only in the Node/build
environment — never bundled into the browser runtime:

```ts
interface IndexerPlugin {
  name: string;
  apiVersion: string;
}

interface SourceAdapter extends IndexerPlugin {
  discover(config: unknown): AsyncIterable<RawDocument>;
}

interface LanguageProfile extends IndexerPlugin {
  code: string;                      // BCP-47
  segment(text: string): TokenSpan[];
  foldDiacritics: boolean;
  stopwords: Set<string>;
  stem(token: string): string;
}

interface ShardCodec extends IndexerPlugin {
  format: string;                    // "json" | "binary" | a custom name
  encode(shard: ShardData): Uint8Array;
}
```

`SourceAdapter` formalizes what
[01-architecture.md](../../concepts/architecture.md) already
described informally (HTML crawl, JSON feed, CMS API); `LanguageProfile`
formalizes [03-tokenization-i18n.md](../../guides/internationalization.md);
`ShardCodec` formalizes the JSON/binary tier split in
[../../concepts/index-format.md](../../concepts/index-format.md) — this doc doesn't introduce
new capabilities, it's the interface layer that makes the capabilities
already designed elsewhere actually swappable.

### Build configuration

```ts
// searchable.config.ts
import { defineConfig } from "@ktjn/searchable-indexer";
import { html } from "@ktjn/searchable-adapter-html";
import { en, de } from "@ktjn/searchable-lang";
import { binary } from "@ktjn/searchable-codec-binary";

export default defineConfig({
  source: html({ sitemap: "https://example.com/sitemap.xml" }),
  languages: [en(), de()],
  codec: binary(),   // omit for the JSON-tier default
});
```

A custom in-house adapter (e.g. a bespoke CMS integration not worth
publishing as a package) is just a plain object satisfying
`SourceAdapter` passed to `source:` directly — the contract is a
TypeScript interface, not a registry a plugin must sign up to, so
one-off/private plugins cost nothing extra to write.

## Versioning

Every plugin declares `apiVersion` (a semver range against core's hook
contract version, not the plugin's own release version). Core checks
this at registration/build time and throws a clear
`IncompatiblePluginError` naming the plugin and the mismatch, rather
than letting an incompatible plugin silently misbehave against hooks
whose shape changed underneath it — the hook contract itself
(`RuntimePluginContext`, `IndexerPlugin` family) is documented and
versioned independently of any single plugin or core release, precisely
so third parties can write and maintain their own plugins against a
stable target.

## Why not fewer, bigger modules instead

The alternative — one configurable "search-features" module with
feature flags instead of a plugin array — was considered and rejected:
flags still require core to `import` every feature's code to be able to
flag it off, defeating the bundle-size goal, and every feature's test
suite would end up implicitly coupled through the shared module rather
than independently mockable. A plugin array with a narrow hook contract
gets modularity *and* small bundles *and* independent testability from
one mechanism, which is why it's worth the (modest) extra ceremony of
an explicit `plugins: [...]` array over a single settings object.
