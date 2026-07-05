# CMS Control Surface: Meta Tags

Given the initial index is built from rendered HTML
([14-reference-deployment-cms-2k.md](14-reference-deployment-cms-2k.md#ingestion-from-rendered-html)),
**meta tags (and a small number of `data-csf-*` element attributes) are
the single control surface** the CMS uses to influence indexing and
search behavior — not a separate config file, not a CMS-specific plugin.
This is deliberate: whatever the CMS is, if its templates/fields can
render an arbitrary `<meta>` tag (every CMS can), authors and template
developers get full control without any integration work beyond that.

This doc is the authoritative reference for every supported tag,
consolidating and extending the table introduced in
[14-reference-deployment-cms-2k.md](14-reference-deployment-cms-2k.md#ingestion-from-rendered-html).

## Design rules

- **Every tag is optional and has a sane zero-config default.** A page
  with no `csf-*` tags at all still indexes correctly using the default
  extraction rules — the tags are for overriding, not required
  configuration.
- **Namespace**: all indexing-control meta tags use `name="csf-*"`
  (a couple of structural ones reuse existing standard tags — `<title>`,
  `<meta name="description">`, `<html lang>`, `<link rel="canonical">` —
  rather than reinventing tags that already exist and that CMS templates
  already commonly set for SEO purposes).
- **Multi-valued tags repeat the element** (`<meta name="csf-facet-tags" content="...">`
  appearing multiple times), not comma-lists inside one tag, except where
  noted — repeated elements are easier for CMS field-repeaters to emit
  than building a delimited string, and avoid delimiter-escaping bugs.
- **Build-time linting, not silent failure**: the indexer validates
  every `csf-*` tag it encounters (known name, well-formed content) and
  emits a build warning (with file/URL) for anything malformed or
  unrecognized — e.g. a typo'd tag name should surface as "unknown tag
  `csf-boots` on /pricing — did you mean `csf-boost`?" during the build,
  never fail silently at query time where it'd be invisible.

## Full reference

| Tag | Controls | Example | Default if absent |
|---|---|---|---|
| `<title>` | Document title | `<title>Pricing</title>` | — (required by HTML anyway) |
| `<html lang="...">` | Document language | `<html lang="de">` | falls back to the index's `defaultLanguage` |
| `<meta name="description">` | Stored excerpt shown in results | `<meta name="description" content="...">` | derived by truncating the extracted body |
| `<link rel="canonical">` | The URL recorded for this doc | `<link rel="canonical" href="https://.../pricing">` | the crawled/file's own URL |
| `data-csf-body` (element attribute) | Marks the exact content region to index | `<div data-csf-body>...</div>` | `<main>` if present, else `<body>` minus nav/header/footer/aside/script/style |
| `data-csf-ignore` (element attribute) | Excludes a sub-element from the body region | `<div data-csf-ignore>related links...</div>` | nothing excluded beyond the structural default |
| `<meta name="csf-noindex">` | Excludes the whole page from the index | `<meta name="csf-noindex" content="true">` | page is indexed |
| `<meta name="csf-boost">` | Document-level score multiplier | `<meta name="csf-boost" content="2.0">` | `1.0` |
| `<meta name="csf-facet-<field>">` | Adds a value for facet field `<field>` | `<meta name="csf-facet-category" content="pricing">` | no facet values for that field |
| `<meta name="csf-pin">` | Query term(s)/phrase this page should be pinned for — see [16-term-to-page-pinning.md](16-term-to-page-pinning.md) | `<meta name="csf-pin" content="pricing">` | no pins |
| `<meta name="csf-pin-priority">` | Tie-break order when multiple pages pin the same term | `<meta name="csf-pin-priority" content="10">` | `0`; ties broken by doc boost, then build order (with a build warning either way — see [16](16-term-to-page-pinning.md#conflicting-pins)) |
| `<meta name="csf-pin-mode">` | `exact` (whole normalized query must match) or `contains` (query containing the term matches) | `<meta name="csf-pin-mode" content="contains">` | `exact` |
| `<meta name="csf-pin-exclusive">` | If present, a matching query shows **only** this result, not organic results alongside it | `<meta name="csf-pin-exclusive" content="true">` | absent — pin is inserted above organic results, which still show |

## Precedence

Structural extraction (title/body/language) always runs first to
produce the default values; any `csf-*` tag present for that page
overrides the corresponding default. There's no cross-page precedence
question for most tags (each page only controls its own fields) —
the one exception is pin conflicts (two different pages pinning the
same term), handled explicitly in
[16-term-to-page-pinning.md](16-term-to-page-pinning.md#conflicting-pins),
not by an implicit precedence rule buried here.

## Why not a separate config file

A central config file (mapping URLs → boosts/facets/pins) was
considered and rejected as the primary mechanism: it puts search
configuration in a place disconnected from the content it describes,
meaning two systems of record for the same page (the CMS entry, and a
config file entry) that can drift out of sync as pages are added, moved,
or removed. Meta tags travel with the page itself, are editable by
whoever already edits that page's template/fields in the CMS, and
require zero additional tooling to keep in sync — consistent with the
"simple over clever" principle in
[00-overview.md](00-overview.md#guiding-principles). A centralized view
is still available: the indexer emits a build-time report (all pins,
boosts, and facet values found, with source URLs) precisely so authors
get auditability without needing a config file to get it from.
