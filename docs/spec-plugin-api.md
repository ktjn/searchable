# Plugin API Specification

Status: Draft

**Relationship to [17-plugin-architecture.md](17-plugin-architecture.md)**:
that doc is this project's concrete, decided plugin contract — a fixed
six-stage hook pipeline (`analyzeQuery → expandQuery → planFetch →
score → filter → assembleResults`) that every existing "plugin" concept
(fuzzy, synonyms, facets, pins, highlighting, vector, per-language
profiles) already maps onto, referenced by the roadmap and the plugin
table there. This document's per-category typed-interface design
(`AnalyzerPlugin`, `QueryRewritePlugin`, `RankingPlugin`, etc.) is a
more abstract restatement of similar goals from a different angle, not
a second, competing contract to implement — 17's hook-registry shape is
authoritative for this repo. Treat the ideas unique to this doc
(metadata/compatibility negotiation shape, per-category rule lists) as
candidate refinements to fold into 17 later, not as a parallel design to
build against.

## Purpose

The Plugin API defines how optional behavior can be added without changing the core search engine.

Plugins should extend the system through explicit extension points. They must not rely on internal implementation details.

## Goals

- Keep the core small.
- Enable optional capabilities.
- Preserve deterministic behavior.
- Avoid tight coupling between plugins and internals.
- Support compatibility negotiation.
- Keep browser runtime cost predictable.

## Non-goals

The Plugin API should not:

- expose private engine internals
- allow plugins to mutate arbitrary state
- require external dependencies
- require dynamic remote code loading
- compromise deterministic ranking
- bypass security validation

## Plugin Types

Supported plugin categories may include:

- analyzer plugins
- tokenizer plugins
- stemmer plugins
- query rewrite plugins
- synonym plugins
- fuzzy matching plugins
- ranking plugins
- facet plugins
- storage plugins
- highlighter plugins
- diagnostics plugins

Each plugin type should have a narrow interface.

## Registration

Plugins should be registered explicitly.

```ts
const client = new SearchClient({
  indexUrl: "/search/manifest.json",
  plugins: [
    synonymPlugin(),
    fuzzyPlugin(),
    customRankingPlugin(),
  ],
});
```

Implicit plugin discovery is not part of the baseline design.

## Plugin Metadata

Every plugin should declare metadata.

```ts
interface PluginMetadata {
  name: string;
  version: string;
  type: PluginType;
  compatibleWith: {
    client: string;
    index?: string;
  };
  capabilities: string[];
}
```

The client should validate plugin metadata during initialization.

## Lifecycle

Plugins may participate in a controlled lifecycle.

```ts
interface PluginLifecycle {
  setup?(context: PluginContext): void | Promise<void>;
  ready?(): void | Promise<void>;
  dispose?(): void | Promise<void>;
}
```

Lifecycle hooks must be deterministic and must not perform hidden query-time side effects.

## Plugin Context

Plugins receive a limited context.

```ts
interface PluginContext {
  version: string;
  logger: PluginLogger;
  capabilities: CapabilityRegistry;
}
```

The context must not expose mutable engine internals.

## Analyzer Plugins

Analyzer plugins may provide language profiles.

```ts
interface AnalyzerPlugin {
  metadata: PluginMetadata;
  languages(): LanguageProfile[];
}
```

Rules:

- index-time and query-time analysis must use the same plugin version
- analyzer output must be deterministic
- analyzers must not depend on network calls at query time

## Query Rewrite Plugins

Query rewrite plugins modify the analyzed query before planning.

Examples:

- synonyms
- spelling correction
- acronym expansion
- custom business aliases

```ts
interface QueryRewritePlugin {
  rewrite(input: QueryRewriteInput): QueryRewriteResult;
}
```

Rewrite plugins must preserve explainability by returning the reason for every expansion.

## Ranking Plugins

Ranking plugins may adjust or replace scoring.

```ts
interface RankingPlugin {
  score(input: RankingInput): RankingResult;
}
```

Rules:

- ranking must be deterministic
- ties must be resolved consistently
- ranking changes must be explainable
- ranking plugins must declare required index features

## Facet Plugins

Facet plugins may define custom facet behavior.

Examples:

- numeric range facets
- date facets
- hierarchical facets
- custom bucket logic

Facet plugins must define:

- index-time representation
- query-time filtering
- count semantics
- serialization format

## Storage Plugins

Storage plugins implement `IndexStorage`.

Examples:

- HTTP storage
- IndexedDB storage
- Service Worker storage
- File System storage

Storage plugins must pass the storage conformance suite.

## Highlighter Plugins

Highlighter plugins generate snippets or marked ranges.

Rules:

- no unsafe HTML by default
- output must be escaped unless explicitly configured
- original document text must not be mutated

## Diagnostics Plugins

Diagnostics plugins may observe:

- query planning
- shard loading
- scoring
- timing
- cache behavior

Diagnostics plugins must not affect search results.

## Capability Negotiation

Plugins may require capabilities.

Examples:

- binary index support
- positions in postings
- stored field availability
- phrase matching
- vector shards

Initialization must fail clearly if required capabilities are unavailable.

## Compatibility

Plugins must declare compatibility with:

- client version
- index version
- plugin API version
- optional index features

Unknown plugin API major versions must be rejected.

## Isolation

Plugins should be isolated by interface, not by sandbox.

Baseline assumption:

- plugins are trusted code bundled with the application

Future remote plugin execution is out of scope.

## Error Handling

Plugin errors should be typed and attributed.

Recommended errors:

- `PluginCompatibilityError`
- `PluginInitializationError`
- `PluginExecutionError`
- `PluginCapabilityError`

A plugin failure should not leave the engine in a partially initialized state.

## Performance Requirements

Plugins must declare expected cost where meaningful.

Examples:

- bundle size impact
- query-time CPU cost
- extra shard requirements
- memory impact

The core should expose timings so plugin overhead is measurable.

## Security Considerations

Plugins must not:

- load remote code implicitly
- bypass manifest validation
- introduce unsafe HTML by default
- mutate shared internal state
- silently change origin policy

Highlighters and render-related plugins must treat all indexed content as untrusted.

## Testing Requirements

Each plugin type should have a conformance suite.

Tests should cover:

- initialization
- compatibility checks
- deterministic output
- failure behavior
- explain output
- performance budget impact

## Success Criteria

The Plugin API succeeds when new capabilities can be added through stable extension points without modifying the query planner, executor or storage internals.