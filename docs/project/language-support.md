# Swedish, Norwegian, and Dutch language support

## Status

Implemented.

## Goal

Searchable provides equivalent TypeScript and Python analysis for Swedish, Dutch, Norwegian Bokmål, and Norwegian Nynorsk. Documents may use the standard language tags `sv`, `nl`, `nb`, or `nn`. The generic Norwegian tag `no` remains accepted as a compatibility alias for Bokmål analysis.

The feature includes stemming, automatic language detection, indexing, querying, documentation, and showcase coverage. Index-time and query-time normalization must remain identical, and the TypeScript and Python implementations must produce the same stems.

## Language codes

| Tag | Meaning | Analysis |
| --- | --- | --- |
| `sv` | Swedish | Swedish Snowball stemmer |
| `nl` | Dutch | Dutch Snowball stemmer |
| `nb` | Norwegian Bokmål | Norwegian Snowball stemmer |
| `nn` | Norwegian Nynorsk | Norwegian Snowball stemmer |
| `no` | Generic Norwegian compatibility tag | Norwegian Snowball stemmer with Bokmål detection semantics |

`nb` and `nn` are distinct registered profiles even though Snowball defines one Norwegian algorithm for both written standards. Explicit `no` documents retain their `no` index partition; the alias does not silently rewrite stored language metadata to `nb`. Automatic detection returns `nb` or `nn`, never `no`, because a generic alias is not a more precise classification than either written standard.

Regional tags such as `sv-SE`, `nl-NL`, and `nb-NO` remain outside this change. The current registry accepts exact base codes, and adding general BCP 47 fallback is a separate concern.

## Analysis architecture

The existing `LanguageProfile` boundary remains unchanged. Four canonical profiles and one compatibility profile are provided by both analysis packages:

- TypeScript exports the profiles and stemmer functions from `@ktjn/searchable`'s `analysis` module.
- Python exports equivalent profiles and stemmer functions from `searchable.analysis`, part of the consolidated `python/searchable` package.
- Both registries recognize all five tags.
- Latin word segmentation remains `Intl.Segmenter` in TypeScript and the existing Unicode word segmenter in Python.
- Diacritic folding remains disabled. Swedish `å`, `ä`, and `ö`, Norwegian `æ`, `ø`, and `å`, and Dutch accented forms enter the appropriate stemmer unchanged.
- Stopword removal remains disabled, matching the existing English and German profiles.

The new stemmers are direct, dependency-free implementations of the published Snowball algorithms. This keeps browser bundles self-contained and prevents an index built in one environment from depending on a native or third-party stemming package unavailable in another.

## Detection

The deterministic Latin-script detector has small, curated marker-word sets for `sv`, `nl`, `nb`, and `nn`. Marker words are exclusive across every registered Latin detection profile. Detection continues to select the profile with the greatest marker count and returns no result for zero-signal or tied text.

The `no` alias has no independent marker set. When Bokmål markers are present, automatic detection returns `nb`; `no` is used only when content declares it explicitly.

Explicit `<html lang>` or searchable language metadata continues to take precedence over detection. Unsupported or regional tags continue to produce the existing clear unsupported-language error.

## Data flow

1. The indexer reads an explicit language tag or invokes deterministic detection.
2. The registry resolves that tag to its language profile.
3. The shared analysis pipeline segments, lowercases, and stems document terms.
4. The index is partitioned under the resolved document tag.
5. The browser client resolves the same tag and applies the identical stemming rules to queries.

No manifest, shard, or public client API shape changes are required.

## Verification

Each language has focused TypeScript and Python stemmer tests plus the standard Snowball input/output vocabulary as conformance fixtures. Verification covers:

- every reference word produces the expected stem in both implementations;
- TypeScript and Python reference outputs are identical;
- all five tags resolve to the intended profile and appear in the public exports;
- Swedish, Dutch, Bokmål, and Nynorsk marker text is detected correctly;
- ambiguous, unsupported, and alias cases retain deterministic fallback behavior;
- indexing and querying inflected forms returns the expected document for each language;
- explicit `no` content stays in a `no` partition while using Norwegian stemming;
- existing English, German, CJK, and Southeast Asian behavior remains unchanged.

Reference fixtures and algorithm implementations record their Snowball source and license provenance.

## Documentation and showcase

The internationalization guide and compatibility reference list the new tags, explain `no` alias behavior, and distinguish explicit tagging from automatic detection. The multi-language showcase corpus includes searchable Swedish, Dutch, Bokmål, and Nynorsk pages alongside the existing English and German examples.

## Non-goals

- stopword removal;
- general BCP 47 regional-tag fallback;
- ML-based language identification;
- Danish or other additional Snowball languages;
- changing index formats or package publication state.

This extends existing language profiles without changing architecture, storage formats, deployment, or security policy, so no ADR is required.
