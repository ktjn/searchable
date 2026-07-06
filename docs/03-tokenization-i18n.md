# Tokenization & Internationalization

**Status**: The `LanguageProfile` abstraction is built with four real
profiles (`english`, `german`, `chinese`, `japanese` —
[`packages/analysis`](../packages/analysis)), and the indexer/client
genuinely partition a multi-language corpus by each document's own
declared language (not a single language forced onto the whole batch)
— see [09-roadmap.md](09-roadmap.md#status). `english` and `german`
have real stemmers (see [Stemming](#stemming) below); `chinese` and
`japanese` use bigram-fallback segmentation (see
[Segmentation](#segmentation) below) with identity stemming, matching
the documented no-op rule for languages without inflectional
morphology. Auto language detection (`@csf/analysis`'s
`detectLanguage()`) and an `isRtlLanguage()` primitive are now built too
— see their own paragraphs below for exact scope. Still pending:
Thai/Khmer/Lao segmentation and the higher-precision
`Intl.Segmenter`-dictionary path for `chinese`/`japanese`.

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
  word segmentation is wrong. **Status**: the `chinese`/`japanese`
  `LanguageProfile`s (`packages/analysis/src/segment-cjk.ts`) ship the
  **n-gram (bigram) fallback** outright — a run of consecutive
  Han/hiragana/katakana characters splits into overlapping
  2-character windows (`"自然語言"` -> `"自然"`, `"然語"`, `"語言"`),
  guaranteeing correct substring matching in any environment without a
  bundled dictionary, at the cost of some index size and relevance
  precision versus true word-boundary segmentation. A lone
  single-character run indexes as that one character rather than
  being dropped. A run of non-CJK characters (Latin words, digits,
  punctuation, whitespace — common inline in real CJK text) segments
  normally via `Intl.Segmenter`. The originally-planned primary path,
  dictionary-based `Intl.Segmenter` word segmentation with locale
  `ja`/`zh` (both browsers and Node support it for these locales) and
  the bigram approach only as a *fallback* for environments where that
  support is incomplete, remains a documented future upgrade — reliably
  detecting "incomplete `Intl.Segmenter` support" portably across the
  arbitrary browsers/Node versions this runtime targets isn't
  straightforward, so the guaranteed-correct bigram path is what ships
  today, unconditionally, rather than gated behind that detection.
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
  (see below, no `LanguageProfile` built yet for either) and making sure
  the *rendering* layer (result highlighting, snippet display) respects
  `dir="rtl"` — a UI concern flagged in
  [08-modern-features.md](08-modern-features.md). **Implemented**:
  `@csf/analysis`'s `isRtlLanguage(code)` (re-exported from
  `@csf/client`) is the one small, stable fact the core library hands
  over for this — a BCP-47-primary-subtag check against the common RTL
  language codes (`ar`, `he`, `fa`, `ur`, ...), independent of whether a
  `LanguageProfile` is registered for that code. Combined with
  `SearchResult.language` (the resolved language a result set came
  from — every hit in one result is from the same language partition,
  docs/07-client-api.md), a consuming app can set `dir="rtl"` on its
  results container without re-deriving either fact itself. The actual
  RTL *layout* (DOM/CSS) stays a consuming-app responsibility, per
  [08-modern-features.md](08-modern-features.md#accessibility) — this
  isn't a step toward building a UI framework, just the one primitive
  the core library is positioned to provide.

## Auto language detection

**Implemented** (`packages/analysis/src/detect-language.ts`'s
`detectLanguage()`), used as a fallback inside
`packages/indexer/src/extract.ts` only when a source document declares
no `<html lang>` attribute at all — an explicit `lang` attribute (or an
explicitly-passed `defaultLanguage` when detection itself has no
confident signal) always wins. Deliberately not a bundled ML model,
resolving the roadmap's own open question ("how much bundled model size
is worth it for higher detection accuracy vs. just requiring explicit
`language` tagging") in favor of a zero-bundle-cost heuristic for the
common case instead:

- **Script-based detection for CJK**: unambiguous and needs no data
  table — a meaningful fraction of Han/Hiragana/Katakana characters
  (≥30%, guarding against one stray CJK character in an otherwise-Latin
  page) classifies the text as Chinese or Japanese; presence of any
  Hiragana/Katakana at all picks Japanese over Chinese, since real
  Chinese text essentially never contains kana.
- **Small curated function-word lists for Latin-script languages**
  (English, German — the two Latin-script `LanguageProfile`s that
  exist): counts occurrences of each language's list against the text
  and picks the language with a strictly higher count; a tie (including
  0-0) returns no detection. Deliberately independent of
  `LanguageProfile.stopwords` (which stays empty everywhere today — "no
  stopword removal yet") — this is purely a detection signal, not a
  change to the indexing pipeline.
- Only ever chooses among the language codes actually passed in as
  candidates (in practice, every code `@csf/analysis`'s registry has a
  profile for) — a hypothetical future Latin-script `LanguageProfile`
  with no word list added to this module simply can't be detected,
  callers keep falling back to `defaultLanguage` exactly as if this
  function didn't exist, not a regression.

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
- **This flag only controls folding *before* analysis runs** — it says
  nothing about what a language's `stem()` does afterward. German's
  real stemmer ([Stemming](#stemming) below) unconditionally folds any
  *remaining* ä/ö/ü to a/o/u as its own last step (standard,
  spec-correct Snowball behavior, not a bug), so `schon` and `schön`
  reach `stem()` as the distinct strings `foldDiacritics: false`
  promises, but both still end up stemmed to `"schon"`. The flag's
  value held completely before a real German stemmer existed (identity
  passthrough meant nothing downstream could re-fold anything); once
  stemming is real, "distinct going in" and "distinct coming out" are
  two different guarantees, and this project only makes the first one.

## Stopwords

Per-language stopword lists (standard Snowball/Lucene-derived lists
ship by default) are applied only to non-phrase, non-quoted query terms
— phrase queries retain stopwords so `"to be or not to be"` still works.
Stopword removal is configurable per field (e.g. keep stopwords in a
`code` field where "or", "and" might be meaningful tokens/operators).

## Stemming

**Status**: `english` ships a real stemmer —
[`packages/analysis/src/stemmer-en.ts`](../packages/analysis/src/stemmer-en.ts)
implements the classic Porter algorithm (M.F. Porter, "An algorithm for
suffix stripping", 1980): "running"/"runs" and "widget"/"widgets" index
and query to the same term. Deliberately the *original* 1980 algorithm,
not the later Snowball-framework "Porter2" English stemmer (a distinct,
incompatible rule set with its own suffix tables) — the two are easy to
conflate since Porter himself later built Snowball, but this module
implements only the original, and a Porter2 upgrade would be a separate
rewrite, not an incremental tweak, if ever undertaken. Verified against
the standard 23,531-word public reference vocabulary
(`packages/analysis/test/fixtures/porter-{input,output}.txt`) with zero
mismatches — not just a hand-picked sample of example words. `german`
now also ships a real stemmer —
[`packages/analysis/src/stemmer-de.ts`](../packages/analysis/src/stemmer-de.ts)
implements the Snowball German algorithm (a from-scratch port; unlike
English, there's no pre-Snowball "classic" German stemmer to implement
instead), verified against the standard 35,053-word public reference
vocabulary
(`packages/analysis/test/fixtures/german-{input,output}.txt`) with
zero mismatches. Its rule set is a genuinely different shape from
English's: region-based (`R1`/`R2`, computed once per word — the same
"first vowel-then-non-vowel transition" recipe Porter2-family stemmers
use, plus a German-specific "R1 starts at index ≥ 3" minimum) rather
than measure-based, four ordered suffix-stripping passes rather than
English's numbered steps, and a prelude/postlude pair that folds
ß→"ss" and ae/oe/ue→ä/ö/ü going in, then folds any *remaining*
umlaut back down to a plain vowel (ä→a, ö→o, ü→u) coming back out —
which means `schon` and `schön` (docs/03-tokenization-i18n.md#case-folding--diacritics)
now both stem to `"schon"`, an accepted tradeoff of shipping the real,
spec-conforming algorithm rather than the earlier identity passthrough.

**Interaction with fuzzy matching**: a query is stemmed *before* fuzzy
candidate lookup, same as at index time. A typo of a real word is only
guaranteed to surface through the strict `maxEdits:1` dictionary if
it's edit-distance-1 from that word's *stemmed* form, not necessarily
its surface form — stemming a non-word typo can itself shift character
count in ways a naive "one edit away" typo doesn't survive (e.g.
`"wireles"`, a one-character deletion of "wireless", stems to `"wirel"`
via the ordinary plural-`s`-stripping rule, three edits from the
stemmed-but-unchanged real term "wireless" — well past `maxEdits:1` —
while `"wirelss"`, deleting a different character, stems to itself and
remains a true one-edit match). This is an inherent consequence of
combining stemming and fuzzy matching, not a bug in either.

**Target design below is still mostly not built.** The original plan
called for ships-many-languages **Snowball-algorithm stemmers**
(compiled to small JS, one module per language, loaded only for
languages actually present in the index — see the per-language plugin
split in [01-architecture.md](01-architecture.md#runtime-the-query-engine))
for: English, French, German, Spanish, Portuguese, Italian, Dutch,
Russian, Swedish, Norwegian, Danish, Finnish, Hungarian, Romanian,
Turkish. German is now built (above); the rest of this list remains
pending, and each is its own from-scratch rule set/reference-vocabulary
verification, not a mechanical repeat of German's.

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
  index and "cafe" both resolve to the same stemmed/folded token. A
  German index does *not* keep `schön` distinct from `schon` (see the
  "Case folding & diacritics" status note above) — both are real,
  different German words that happen to collide once the real stemmer's
  umlaut-fold runs, an accepted tradeoff of shipping a real stemmer
  rather than the earlier identity passthrough.

## Testing strategy

Analysis correctness is the highest-leverage thing to get right and the
easiest to silently break, so the design calls for:
- A golden-file test corpus per supported language (representative
  sentences with expected token streams) run against both the indexer's
  and runtime's analysis entry points to guarantee they're byte-for-byte
  the same pipeline (not just "equivalent" reimplementations).
- Round-trip tests: index N documents in language X, assert querying
  known substrings/inflections/synonyms retrieves them.
