# CMS meta tags

This reference defines the implemented HTML authoring controls consumed by the reference indexers.

| Control | Meaning | Default |
|---|---|---|
| `<title>` | Stored title and title field | Empty title |
| `<html lang="…">` | Document language | Build default or detection |
| `<link rel="canonical">` | Result URL after protocol/origin validation | Crawled source URL |
| `data-searchable-body` | Exact body region to index | `<main>`, then `<body>` |
| `data-searchable-ignore` | Exclude a descendant from the body | Structural boilerplate only |
| `<meta name="searchable-noindex">` | Exclude the page | Indexed |
| `<meta name="searchable-boost" content="2.0">` | Document score multiplier | `1.0` |
| `<meta name="searchable-facet-<field>" content="…">` | Repeatable terms/hierarchy facet value | No value |
| `<meta name="searchable-facet-range-<field>" content="…">` | Numeric range-facet value | No value |
| `<meta name="searchable-facet-geo-<field>" content="lat,lon">` | Geo-facet coordinate (`lat` in [-90, 90], `lon` in [-180, 180]) | No value |
| `<meta name="searchable-stored-<field>" content="…">` | Custom stored (not indexed, no facet) field value | No value |
| `<meta name="searchable-pin" content="…">` | Repeatable pin phrase | No pin |
| `<meta name="searchable-pin-priority" content="10">` | Pin tie-break priority | `0` |
| `<meta name="searchable-pin-mode" content="contains">` | `exact` or `contains` matching | `exact` |
| `<meta name="searchable-pin-exclusive">` | Suppress organic results for a matching pin | Non-exclusive |

Repeat a meta element for multiple values. Invalid numeric boosts fall back to `1.0`; malformed range values are ignored; a malformed or out-of-range `searchable-facet-geo-<field>` value is also ignored, with a build-time warning. `searchable-stored-<field>` adds `field` to `Manifest.fields` as `stored: true, indexed: false` and populates it in the doc-store, without declaring a facet shard -- it's the authoring-side way to make a field reachable by [`SearchOptions.filters`' exact-match-on-stored-fields fallback](../guides/facets.md#exact-match-on-stored-fields) or simply for display, without also making it a facet or full-text-searchable; the first tag per field wins, and `title`/`excerpt`/`pageTitle` are reserved (the indexer already populates those) and are silently ignored. Canonical URLs permit only HTTP(S), and `allowedUrlOrigins` can restrict them further. `canonicalBaseUrl` is required to resolve non-root-relative references safely.

## Canonical URL

An absolute canonical URL must use HTTP(S) and, when configured, match `allowedUrlOrigins`. Root-relative URLs are accepted; other relative values need `canonicalBaseUrl` or fall back to the crawled source URL.

Body extraction removes `nav`, `header`, `footer`, `aside`, `script`, and `style` from the selected region in addition to `data-searchable-ignore` descendants. See [Pinning](../guides/pinning.md) and [Facets](../guides/facets.md) for query-time behavior.
