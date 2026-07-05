# Tokenization & Internationalization

**Status**: The `LanguageProfile` abstraction is built with two real
profiles (`english`, `german` — [`packages/analysis`](../packages/analysis)),
and the indexer/client genuinely partition a multi-language corpus by
each document's own declared language (not a single language forced
onto the whole batch) — see [09-roadmap.md](09-roadmap.md#status).
Still pending: real stemmers (both profiles are an identity pass),
CJK/Thai segmentation and bigram fallback, RTL-aware result rendering,
and auto language detection.

The single hardest correctness requirement: **the exact same analysis
pipeline must run at index time and at query time**, per language,
otherwise terms silently never match. This doc defines that pipeline and
how it's kept in sync (it's shared code — `@csf/analysis` — imported by
both the Node indexer and the browser runtime, not reimplemented twice).

## Pipeline stages

```
raw text
  → Unicode normalization (NFKC)
  → language-specific segmentation (tokenize into words)
  → case folding
  → diacritic folding (language-dependent, see below)
  → stopword removal (language-specific list, optional)
  → stemming / lemmatization (language-specific)
  → token stream with positions
```

Every stage after normalization is **pluggable per language** via a
`LanguageProfile`:

```ts
interface LanguageProfile {
  code: string;                 // BCP-47, e.g. "en", "de", "zh-Hans"
  segment(text: string): TokenSpan[];
  foldDiacritics: boolean;
  stopwords: Set<string>;
  stem(token: string): string;
}
```

Shipped profiles cover common languages out of the box; consumers can
register a custom profile for anything unsupported.

## Segmentation

- **Space-delimited languages** (English, German, French, Spanish,
  Russian, etc.): split on Unicode word boundaries using
  [`Intl.Segmenter`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter)
  (`granularity: "word"`), which is native in all modern browsers and in
  Node ≥ 16 for the indexer — no bundled segmentation tables needed for
  this group.
- **CJK (Chinese, Japanese)**: no whitespace between words, so naive
  word segmentation is wrong. Use `Intl.Segmenter` with locale `ja`/`zh`
  (both browsers and Node support dictionary-based segmentation for these
  locales), falling back to **n-gram (bigram) indexing** as a robustness
  net for locales/environments where `Intl.Segmenter` support is
  incomplete — bigram indexing trades some precision for guaranteed
  correctness without a bundled dictionary.
- **Korean**: whitespace-delimited at the word (eojeol) level, but
  agglutinative morphology means stemming matters more than segmentation;
  segmentation uses `Intl.Segmenter`, morphological analysis is a
  best-effort suffix-stripping stemmer (see below).
- **Thai/Khmer/Lao** (no spaces, no `Intl.Segmenter` dictionary support
  in all engines at time of writing): bigram/trigram fallback the same as
  the CJK robustness net, or an optional bundled dictionary-segmentation
  plugin for higher precision if the corpus is Thai-heavy.
- **Right-to-left (Arabic, Hebrew)**: segmentation is whitespace-based
  like Latin scripts; the interesting work is script-specific stemming
  (see below) and making sure the *rendering* layer (result highlighting,
  snippet display) respects `dir="rtl"` — a UI concern flagged in
  [08-modern-features.md](08-modern-features.md).

## Case folding & diacritics

- Case folding: `toLocaleLowerCase(langTag)` (locale-aware — e.g. Turkish
  dotless-ı handling differs from a plain `.toLowerCase()`).
- Diacritic folding is **not** universally correct to enable — e.g.
  folding `é → e` is desirable for French search-as-you-type ergonomics,
  but folding `ü → u` in German changes distinct words
  (`schon`/`schön`), and folding in Vietnamese would collapse many
  distinct words entirely. `LanguageProfile.foldDiacritics` therefore
  defaults per-language based on established IR practice (on for
  French/Spanish/Portuguese, off for German/Vietnamese/Turkish/Nordic
  languages) and is always overridable per index config.

## Stopwords

Per-language stopword lists (standard Snowball/Lucene-derived lists
ship by default) are applied only to non-phrase, non-quoted query terms
— phrase queries retain stopwords so `"to be or not to be"` still works.
Stopword removal is configurable per field (e.g. keep stopwords in a
`code` field where "or", "and" might be meaningful tokens/operators).

## Stemming

Ships **Snowball-algorithm stemmers** (compiled to small JS, one module
per language, loaded only for languages actually present in the index —
see the per-language plugin split in
[01-architecture.md](01-architecture.md#runtime-the-query-engine)) for:
English, French, German, Spanish, Portuguese, Italian, Dutch, Russian,
Swedish, Norwegian, Danish, Finnish, Hungarian, Romanian, Turkish.

For languages without a good affix-stripping stemmer (Chinese, Japanese,
Korean, Thai), stemming is a no-op — segmentation/n-gram matching plus
synonym expansion carries relevance instead, which is standard practice
(these languages don't have Indo-European-style inflectional morphology
that stemming targets).

Lemmatization (dictionary-based, more accurate than stemming) is a
possible future upgrade path per language but requires bundling
dictionaries (size cost) — left as an optional plugin, not default.

## Mixed-language corpora & queries

- Each document can declare its own `language` (or have it detected at
  build time). Multi-language documents (e.g. a page with an English
  title and French body) can tag **per-field** language when needed.
- The inverted index is partitioned by language
  ([02-index-format.md](02-index-format.md#term-shard-inverted-index)),
  so a query only fetches shards for the language(s) it's targeting:
  - If the client specifies a language (typical: site has a language
    switcher), only that partition is queried.
  - If unspecified, the query text is language-detected (a lightweight
    client-side detector, reusing the same detection model as the
    indexer) and that partition is queried first; a "search all
    languages" mode unions all partitions (costs more shard fetches, but
    is opt-in).
- Script-aware query analysis means a query "café" against a French
  index and "cafe" both resolve to the same stemmed/folded token, but a
  German index correctly keeps `schön` distinct from `schon`.

## Testing strategy

Analysis correctness is the highest-leverage thing to get right and the
easiest to silently break, so the design calls for:
- A golden-file test corpus per supported language (representative
  sentences with expected token streams) run against both the indexer's
  and runtime's analysis entry points to guarantee they're byte-for-byte
  the same pipeline (not just "equivalent" reimplementations).
- Round-trip tests: index N documents in language X, assert querying
  known substrings/inflections/synonyms retrieves them.
