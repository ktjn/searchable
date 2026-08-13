# Internationalization

This guide explains the shared analysis pipeline, implemented language profiles, automatic detection, and fallback segmentation.

## Pipeline and profiles

Both indexer implementations and the browser client analyze text through the same conceptual stages: Unicode normalization, segmentation, case folding, optional stopword removal, and optional stemming. English, German, Swedish, Dutch, Norwegian Bokmål, and Norwegian Nynorsk have full stemming profiles; their stopword sets are currently empty.

| Code | Language | Analysis |
| --- | --- | --- |
| `en` | English | Porter stemmer |
| `de` | German | Snowball stemmer |
| `sv` | Swedish | Snowball stemmer |
| `nl` | Dutch | Snowball stemmer |
| `nb` | Norwegian Bokmål | Norwegian Snowball stemmer |
| `nn` | Norwegian Nynorsk | Norwegian Snowball stemmer |
| `no` | Generic Norwegian compatibility tag | Norwegian Snowball stemmer |
| `zh`, `ja` | Chinese, Japanese | CJK bigram fallback |
| `th`, `km`, `lo` | Thai, Khmer, Lao | Trigram fallback |

Use `nb` or `nn` for new Norwegian content. An explicit `no` remains supported for compatibility and keeps its own `no` index partition, but automatic detection returns the more precise `nb` or `nn` and never `no`. Language tags are currently exact base codes; regional forms such as `sv-SE` and `nl-NL` are not resolved automatically.

## Segmentation

Chinese and Japanese use CJK bigrams; Thai, Khmer, and Lao use deterministic trigram fallback segmentation. Unknown language codes fall back safely instead of loading dictionaries at runtime.

## Mixed-language corpora and queries

The indexer resolves language from page metadata and stores separate term, synonym, fuzzy, and pin partitions by language. A query uses `options.language` or the manifest's `defaultLanguage`; one `SearchResult` contains hits from that single partition and reports the resolved `language`.

```ts
const result = await search.search("Suchbegriff", { language: "de" });
```

`isRtlLanguage`, re-exported from `@ktjn/searchable-client`, lets the consuming UI apply `dir="rtl"` for the returned language. Layout, translations, and locale-aware UI labels remain application responsibilities.

## Stemming

English uses a Porter stemmer. German, Swedish, Dutch, Bokmål, and Nynorsk use dependency-free Snowball-compatible stemmers. Bokmål and Nynorsk are separate profiles that share Snowball's Norwegian algorithm. The fallback script profiles use identity stemming.

## Case folding and diacritics

Profiles lowercase text with their locale. Pre-stem diacritic folding is disabled, preserving Swedish `å`/`ä`/`ö`, Norwegian `æ`/`ø`/`å`, and Dutch accented forms for their stemmers. The German stemmer's final step folds remaining umlauts, so `schon` and `schön` converge even though pre-stem diacritic folding is disabled.

## Language detection

Language detection uses Unicode script evidence first and small exclusive marker-word signals for Latin text. It distinguishes Swedish, Dutch, Bokmål, and Nynorsk, is deterministic, and never performs a network request. Explicit page language metadata always wins; short, ambiguous, or tied text falls back to the configured default language.
