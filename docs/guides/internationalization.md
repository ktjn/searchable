# Internationalization

This guide explains the shared analysis pipeline, implemented language profiles, automatic detection, and fallback segmentation.

## Pipeline and profiles

Both indexer implementations and the browser client analyze text through the same conceptual stages: Unicode normalization, segmentation, case folding, optional stopword removal, and optional stemming. English and German have full stemming profiles; their stopword sets are currently empty.

## Segmentation

Chinese and Japanese use CJK bigrams; Thai, Khmer, and Lao use deterministic trigram fallback segmentation. Unknown language codes fall back safely instead of loading dictionaries at runtime.

## Mixed-language corpora and queries

The indexer resolves language from page metadata and stores separate term, synonym, fuzzy, pin, and vector partitions by language. A query uses `options.language` or the manifest's `defaultLanguage`; one `SearchResult` contains hits from that single partition and reports the resolved `language`.

```ts
const result = await search.search("Suchbegriff", { language: "de" });
```

`isRtlLanguage`, re-exported from `@csf/client`, lets the consuming UI apply `dir="rtl"` for the returned language. Layout, translations, and locale-aware UI labels remain application responsibilities.

## Stemming

English uses a Porter stemmer and German uses a Snowball-compatible stemmer. The fallback script profiles use identity stemming.

## Case folding and diacritics

Profiles lowercase text with their locale. The German stemmer's final step folds remaining umlauts, so `schon` and `schön` converge even though pre-stem diacritic folding is disabled.

## Language detection

Language detection uses Unicode script evidence first and small stopword signals for Latin text. It is deterministic and never performs a network request.
