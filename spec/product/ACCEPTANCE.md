# Independent acceptance specification

**Status:** proposed, unapproved. **Scope:** black-box observable behavior for [SYSTEM.md](SYSTEM.md). No test may import, call or copy Searchable 2.x implementation internals.

## Verification policy

1. Write expected inputs/outcomes from product intent before implementing the Orama candidate.
2. Create fresh authored fixtures with clear licensing and known relevance judgments. Do not transcribe existing Searchable test assertions, private corpus data, snapshot digests, or implementation-specific scoring constants.
3. Run the same contract cases against a public high-level interface. Keep adapter-specific tests distinct from product tests.
4. Identify preconditions, inputs, observable outputs, negative cases, corner cases, locale and failure cases. A passing suite supports acceptance only within its stated coverage.
5. Record measured evidence with candidate commit, dependency lock version, dataset digest, browser/device, run mode, timestamp and verifier.
6. Any test whose requirements change must return to requester review; do not weaken an expectation to fit Orama.
7. Proposed test expectations are **not existing passing evidence**. A clean-room implementation cannot inherit \`spec/system.yaml\` evidence.

## Authored datasets

- **F-A: documents.** 12 newly authored static pages with varied title/body scores, exact vocabulary, duplicate words, canonical URLs, one ignored page, one explicit body region, one excluded subtree, one section anchor and one malicious-looking field string.
- **F-B: structured catalog.** 30 records with stable IDs, repeated categories, price boundaries, hierarchical paths, two geo points, one stored-only SKU, ties, duplicate-ID input, zero-content record and editorial pins.
- **F-C: languages.** New content authored or legally sourced separately for en, de, sv, nl, nb, nn. For each, document an exact term, inflection, uncommon word and locale-fallback case. Include one ambiguity and one unsupported tag.
- **F-D: publication.** Complete immutable generation A, complete generation B, corrupted manifest, missing artifact, digest mismatch, disallowed URL, wrong format version, stale descriptor and mixed-generation host simulation.
- **F-E: ranking judgments.** Domain query logs or independently authored task queries, judged by a reviewer who is not copying baseline ordering from the original engine. Record graded relevance and ambiguity rationale.
- **F-F: scale.** Deterministic generated content at 2k, 10k and 50k documents (sizes subject to measured release budgets). Include multilingual fields, long documents, low-selectivity facets and adversarial common queries.

## Functional acceptance catalog

| Test ID | Verifies | Independently observable scenario / oracle |
| --- | --- | --- |
| A-01 | R-01 | Valid records preserve stable external IDs, canonical URLs and stored values; duplicate IDs and absent required URLs reject with typed validation errors. |
| A-02 | R-02 | HTML title/body selection, noindex, excluded navigation and section anchors produce the agreed public records; ignored text is not searchable. |
| A-03 | R-03 | Two otherwise identical documents differ predictably when title or editorial weighting is changed; invalid boosts/field config are diagnosed. |
| A-04 | R-04 | Rebuilding an identical fixture/config yields equivalent content and deterministic build identity; publishing B while A is active never mixes A and B. |
| A-05 | R-05 | Browser searches fixture corpus through local static GET only; there are no outbound query POST/GET calls with raw text to an application search service. |
| A-06 | R-06 | Wrong format, broken reference, corrupted body, unsafe relative path and missing generation fail with typed errors and no partial hit set. |
| A-07 | R-08 | Case/normalization examples match intended tokens without matching unrelated documents; fields excluded from search do not contribute. |
| A-08 | R-09 | Two-term AND and OR results differ as specified; ordered quoted phrases only match ordered contiguous terms; prefix matches expanded words; malformed/empty syntax has explicit behavior. |
| A-09 | R-10 | When all else is equal, a title match outranks body-only match, a direct exact match outranks fuzzy expansion, and equal-ranked documents have stable deterministic order. |
| A-10 | R-11 | One-edit misspelling finds the approved candidate when enabled; disabled tolerance does not; expansion limits prevent candidate explosion. |
| A-11 | R-12 | Equivalent synonym works bidirectionally, directional synonym works only one direction, multiword expansion has the specified matching constraints; cyclic graphs terminate. |
| A-12 | R-13 | Exact/contains promotion conflict resolves by explicit priority, duplicates are collapsed, and a selected filter cannot surface a disallowed pinned hit. |
| A-13 | R-14 | Results are paginated without duplicates/omissions, total is invariant across pages, scalar sort is consistent and ties are stable; invalid page bounds reject. |
| A-14 | R-15 | Highlights are valid character-span ranges for matching visible text; escaped HTML or script-like strings remain inert when rendered by reference UI. |
| A-15 | R-16 | No-result typo yields bounded corpus-grounded suggestion; partial term suggests known continuations; no unsupported candidate is fabricated. |
| A-16 | R-18 | Multiple values within one terms field are OR; different fields are AND; an unknown field returns a declared error rather than silently removing that restriction. |
| A-17 | R-19 | Numeric min/max are inclusive; parent/child taxonomy filters apply consistently; geo radius includes inside/boundary and excludes outside points. |
| A-18 | R-20 | Contextual facet counts exclude current facet selection while respecting other active filters; counts update as selections change. |
| A-19 | R-21 | Canonical public URLs and encoded section anchors navigate to the corresponding content; section identity cannot collide with parent ID. |
| A-20 | R-23 | For each declared required language, exact and inflected queries retrieve the expected document; unsupported locale follows explicit fallback or throws. |
| A-21 | R-24 | Query analyzer and publisher agree per locale; ambiguous languages and mixed-language corpora do not silently cross partitions. |
| A-22 | R-25 | Failed initialization, broken downloads and query after dispose each return distinct typed failures; no failure is reinterpreted as zero hits. |
| A-23 | R-26 | Multiple overlapping wide/narrow searches on one instance equal the results of sequential calls, including facet and locale isolation. |
| A-24 | R-27 | Abort rejects only the caller; no stale results are delivered; disposing while loading blocks all later calls and repeated dispose is safe. |
| A-25 | R-28 | Oversized query/expansion/configured resource limits produce bounded work and a documented error or degraded mode, not OOM/hang. |
| A-26 | R-30 | Index publication rejects designated private fields; unsafe canonical schemes, traversal, and unapproved artifact origins are denied. |
| A-27 | R-31 | Browser network audit shows no remote query/telemetry submission by default; product guidance accurately describes artifact-request leakage. |
| A-28 | R-32 | Malicious field names (including prototype keys), markup, control chars, encoded paths and hostile metadata do not execute code or mutate prototypes. |
| A-29 | R-33 | A framework-neutral adapter can drive search, busy, error, empty, facets, paging, suggestions and navigation without reaching into engine internals. |
| A-30 | R-34 | Reference integration: keyboard-only interaction and screen-reader status/focus flows pass WCAG 2.2 AA evaluation; headless API makes no unsupported accessibility claims. |
| A-31 | R-35 | Cold/warm timings, index transfer bytes, parse/load, memory, bundle, cache behavior and device/browser matrix are reproducible and reviewed against approved budgets. |
| A-32 | R-36 | Independently reviewed query judgments produce MRR, nDCG@5, recall/precision and zero-result rate; regression report identifies per-query degradations. |
| A-33 | R-37 | Publisher/client version compatibility matrix tests supported combination, rejected future/old versions and rollback from B to A. |

**Extension tests (not MVP):** A-34 R-07 build-time incremental update, A-35 R-17 proximity/advanced syntax, A-36 R-22 grouping/collapse, A-37 R-29 offline-after-install, A-38 R-38 opt-in telemetry. These must receive separately approved expected results.

## Boundary and abuse cases

- Empty corpus, empty/whitespace query, all-stopword query, very long query, high-frequency prefix, all-document match, zero-hit query.
- One shard/file unavailable mid-query; stale caching of descriptor while immutable data is replaced; concurrent initialization, reuse and teardown.
- Unicode combining characters, umlauts/diacritics, RTL and CJK content as explicitly supported/fallback tested; regional locale tags and mixed scripts.
- Incorrect field type, NaN/infinity input, reversed numeric bounds, invalid geo coordinates/radius, zero/negative/large limits, injection-like literal input.
- Conflicting promotions, a promoted document excluded by filters, duplicate external IDs, duplicate canonicals, identical-ranked items.

## Independent relevance criteria

Do not assert exact floating-point scores, index bytes, posting IDs, stemming steps or the legacy algorithm. Instead:
- Define each judged query's intent and relevant documents *before* inspecting the new candidate's result order.
- Report per-language and per-domain nDCG@5, MRR, recall@5, precision@5 and zero-result rate.
- Require stable ordering for ties and declared partial-order expectations (e.g. strongly relevant title hit before weaker unrelated body hit).
- Treat measured deltas as reviewable evidence, **not** automatically passing thresholds. Agree numeric release thresholds and tolerated exceptions at the approval gate.

## Non-functional acceptance gate (values not yet approved)

| Metric | Required measurements | Threshold |
| --- | --- | --- |
| First interactive query | cold fetch, parse/restore/build and search, p50/p95 | requester-approved after spike |
| Warm query | cached search p50/p95 including filtering/sorting | requester-approved after spike |
| Initial/total transfer | compressed and actual observed HTTP bytes | requester-approved after spike |
| Browser memory | peak and settled heap; mobile budget | requester-approved after spike |
| Main-thread blocking | long tasks, input delay during load/search | requester-approved after spike |
| Package impact | production bundle bytes and dependency footprint | requester-approved after spike |
| Relevance | domain/language metrics plus per-query judgments | requester-approved after corpus review |

Run Chromium, Firefox and WebKit; representative desktop and low-end mobile; fresh browser context, warm HTTP cache and warm in-memory session. Compare with Searchable's existing CMS-2k evidence only as *performance reference*, never as authorization to copy implementation behavior.

## Traceability / release evidence

Every acceptance record should bind test ID → R-ID → approved spec revision → candidate revision/dependencies → environment → method → pass/fail/evidence. Verify a logical component in isolation with a programmable fake for each dependency, then separately test integration joins. Record unsatisfied obligations and explicit risk acceptance; never create retrospective passing evidence.
