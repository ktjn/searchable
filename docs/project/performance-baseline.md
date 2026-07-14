# Performance baseline

## CMS-2k Chromium vertical baseline

This reviewed run records 10 measured repetitions after 1 warm-up repetition. The exact report SHA-256 is `f26bf2249e07aa0826f3f129846a294db743950042a83750428c5c2d57a58496`.

## Workload

- Generator: `generateCms2kCorpus`
- Documents: 2006
- Languages: en: 1003, de: 1003
- Corpus SHA-256: `af958e84d0169f55258440c0d683604d9411dc4dbe965acd0199a84111c1428d`
- Query set: `cms-2k-lexical-v1` (`ffdc3c47d0e6a522a2f8b044348eca9660664a6b7d458bd80ff5d77ca01d4a72`)
- Reviewed raw JSON: [`reviewed-baseline.json`](../../benchmark-results/cms-2k/reviewed-baseline.json)

## Environment

- Commit: `083ef8bf52a425d1c67a370524cfc65996b24644` (clean: true)
- Platform: win32 10.0.26200 (x64)
- CPU: AMD Ryzen 7 7800X3D 8-Core Processor, 16 logical CPUs
- Node: v24.17.0; pnpm: 11.11.0
- Playwright: 1.61.1; Chromium: 149.0.7827.55
- Headless: true; flags: `--enable-precise-memory-info`

## Index build and output

| Measure | Value |
| --- | ---: |
| Corpus generation | 26.79 ms |
| Index build | 557.35 ms |
| Index write | 421.17 ms |
| Files / shards | 54 / 51 |
| Raw artifact bytes | 13655943 B (13.02 MiB) |
| gzip-equivalent artifact bytes | 650659 B (635.41 KiB) |
| Manifest raw bytes | 4315 B (4.21 KiB) |

## Cold search

Each sample initializes a fresh strict, main-thread client in a fresh Chromium context and executes exactly one query.

| Query | Initialize p50 | Initialize p95 | First query p50 | First query p95 | Combined p50 | Combined p95 | Transfer p50 gzip-equivalent |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| single-term | 1.90 ms | 2.10 ms | 13.30 ms | 14.60 ms | 15.20 ms | 16.60 ms | 40397 B (39.45 KiB) |
| multi-term | 2.00 ms | 2.10 ms | 20.00 ms | 21.20 ms | 22.00 ms | 23.30 ms | 66706 B (65.14 KiB) |
| prefix | 1.90 ms | 2.10 ms | 13.50 ms | 14.20 ms | 15.50 ms | 16.10 ms | 40397 B (39.45 KiB) |
| no-match | 1.90 ms | 2.20 ms | 10.70 ms | 12.70 ms | 12.70 ms | 14.60 ms | 27623 B (26.98 KiB) |
| filtered | 1.90 ms | 2.30 ms | 22.20 ms | 38.80 ms | 24.20 ms | 40.60 ms | 62683 B (61.21 KiB) |
| faceted | 1.80 ms | 2.30 ms | 22.20 ms | 23.30 ms | 24.00 ms | 25.20 ms | 62683 B (61.21 KiB) |

## Warm search

Measured passes made 0 successful index requests.

| Query | p50 | p95 |
| --- | ---: | ---: |
| single-term | 0.30 ms | 0.50 ms |
| multi-term | 0.30 ms | 0.50 ms |
| prefix | 0.20 ms | 0.80 ms |
| no-match | 0.00 ms | 0.20 ms |
| filtered | 0.30 ms | 0.60 ms |
| faceted | 0.40 ms | 0.80 ms |

Whole ordered pass: p50 1.60 ms, p95 2.70 ms.

## Heap status

- After warm initialization: 1726915 B (1.65 MiB)
- After final warm pass: 10959576 B (10.45 MiB)

## Reproduce

```sh
pnpm benchmark:baseline
pnpm benchmark:render <explicit-report-path>
```

## Query definitions

```json
[
  {
    "id": "single-term",
    "query": "benchmark",
    "options": {
      "limit": 10
    },
    "expected": {
      "topUrl": "/en/engineering/engineering-scaling-regression-testing-7.html",
      "totalHits": 125
    },
    "sha256": "55420af95e8c75b32c81c00b55fed377a6854fb1e6a644b4a7f029b0430a504a"
  },
  {
    "id": "multi-term",
    "query": "static shard hosting",
    "options": {
      "limit": 10
    },
    "expected": {
      "topUrl": "/en/guides/guides-how-to-configure-progressive-feature-adoption-10.html",
      "totalHits": 125
    },
    "sha256": "85b3b7b38c25f3a41820b11c8293c0542e97a2ff727fdd4afcf8ed8b90745ff3"
  },
  {
    "id": "prefix",
    "query": "bench*",
    "options": {
      "limit": 10
    },
    "expected": {
      "topUrl": "/en/engineering/engineering-scaling-regression-testing-7.html",
      "totalHits": 125
    },
    "sha256": "52ed379a69dffd1b00d8eda2852edda7f7f6e85b69ef4e24e5ade92fe08a1893"
  },
  {
    "id": "no-match",
    "query": "zzzz-no-match",
    "options": {
      "limit": 10
    },
    "expected": {
      "totalHits": 0
    },
    "sha256": "57c5663f5aee64a184d0b235fe2f3669916166457fa9c69af5cda3e549b2159d"
  },
  {
    "id": "filtered",
    "query": "search",
    "options": {
      "limit": 10,
      "filters": {
        "category": "Engineering"
      }
    },
    "expected": {
      "topUrl": "/en/engineering/engineering-scaling-regression-testing-7.html",
      "totalHits": 250
    },
    "sha256": "67237ffb03bd1f2fde90bb75be14172cbf7d87c065d16aeeb3495d3d13ae7c51"
  },
  {
    "id": "faceted",
    "query": "search",
    "options": {
      "limit": 10,
      "facets": [
        "category"
      ]
    },
    "expected": {
      "topUrl": "/en/product/product-a-closer-look-at-opt-in-search-features-20.html",
      "totalHits": 627,
      "facetValues": [
        {
          "value": "Company",
          "count": 125,
          "selected": false
        },
        {
          "value": "Engineering",
          "count": 250,
          "selected": false
        },
        {
          "value": "Guides",
          "count": 125,
          "selected": false
        },
        {
          "value": "Product",
          "count": 125,
          "selected": false
        }
      ]
    },
    "sha256": "87518f6b7c9374bd47394477618b4bdf94c3afeb1e127d4498108bfa76e7777d"
  }
]
```

## Interpretation limits

This is reproducible evidence from one machine, one Chromium version, one corpus size, and one main-thread lexical profile, not a performance budget. It is also not a supported operating range: different corpora, hardware, browsers, cache states, and query mixes can produce materially different results. gzip-equivalent sizes are level-9 calculations over emitted bytes, not observed Content-Encoding payload sizes.

Remaining work includes multiple corpus sizes and deployment classes; Firefox, WebKit, and low-end mobile measurements; worker, Service Worker, and browser-cache-warm modes; broader lexical, vector, and hybrid query classes; supported operating ranges and shard guidance; and CI comparison without prematurely turning this baseline into a threshold.
