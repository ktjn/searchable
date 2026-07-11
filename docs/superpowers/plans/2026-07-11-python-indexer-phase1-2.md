# Python Index-Creation Support (Phase 1+2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two installable Python packages, `csf-analysis` and `csf-indexer`, giving full feature parity with `@csf/analysis` + the lexical-core subset of `@csf/indexer` — producing a JSON index `@csf/client` can query, with no facets/synonyms/fuzzy/pins/vectors/binary tier yet (those are later, separately spec'd phases).

**Architecture:** Direct, faithful ports of the existing TypeScript source (`packages/analysis/src/*.ts`, `packages/indexer/src/{discover,extract,build-index,write-index,hash,cli}.ts`), file-for-file where practical, adjusted only where Python's language semantics force a difference (documented per-task below — e.g. no `Intl.Segmenter`, no JS-prototype-pollution risk on plain dicts, no type-only circular imports).

**Tech Stack:** Python 3.10+, `uv` + `pyproject.toml` (hatchling build backend) per package, `pytest`, `selectolax` for HTML parsing in `csf-indexer`, `jsonschema` (dev-only) for schema-conformance tests.

## Global Constraints

- Minimum Python version: 3.10 (from the design spec).
- Package layout: `python/csf-analysis/`, `python/csf-indexer/` (new top-level `python/` directory — does not touch pnpm's `packages/*` workspace glob).
- `csf-indexer` depends on `csf-analysis` via a `uv` local path source (`[tool.uv.sources]`), not a published version — both live in this repo.
- No facets, synonyms, fuzzy matching, term pinning, vector shard building, or binary storage tier in this plan — explicitly out of scope (see the design doc's "Out of scope" section). `extract.py` parses facet/range-facet/pin metadata anyway (full parity with `extract.ts`) but `build_index.py` does not consume it yet.
- CLI binary name: `csf-indexer` (same as the npm CLI).
- Every JSON-shaped output (manifest, term shard, doc store shard) must validate against `spec/schema/manifest.schema.json` / `term-shard.schema.json` / `doc-store-shard.schema.json`.
- Python has no prototype-pollution risk on plain `dict` (unlike JS objects), so `packages/analysis/src/safe-dict.ts`'s `getOrCreate`/`ownProp` are **not** ported — plain `dict.setdefault()` / `dict.get()` / `key in dict` are used directly throughout. This is a deliberate simplification, not an oversight — call it out in code review if it looks like a gap.
- Python has no type-only imports (TS erases `import type { ... }` at compile time, so TS's `language-profile.ts` can import from `segment-cjk.ts` while `segment-cjk.ts` imports a type back from `language-profile.ts` with no runtime circularity). To avoid a real circular import in Python, `TokenSpan` lives in its own module (`token_span.py`) rather than alongside `LanguageProfile` in `language_profile.py`. This is the one deliberate file-layout deviation from the TS source; every other module boundary matches its `.ts` counterpart 1:1.

---

## Task 1: `csf-analysis` package scaffold + `TokenSpan`

**Files:**
- Create: `python/csf-analysis/pyproject.toml`
- Create: `python/csf-analysis/src/csf_analysis/__init__.py` (empty for now, filled in Task 10)
- Create: `python/csf-analysis/src/csf_analysis/token_span.py`
- Create: `python/csf-analysis/tests/__init__.py` (empty)
- Test: `python/csf-analysis/tests/test_token_span.py`

**Interfaces:**
- Produces: `TokenSpan(text: str, is_word_like: bool)` — a frozen dataclass, imported by every segmenter module in later tasks as `from csf_analysis.token_span import TokenSpan`.

- [ ] **Step 1: Create the package directory and `pyproject.toml`**

```toml
[project]
name = "csf-analysis"
version = "0.1.0"
description = "Multi-language tokenization, stemming, and language detection for client-search-framework (Python port of @csf/analysis)."
requires-python = ">=3.10"
dependencies = []

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/csf_analysis"]

[dependency-groups]
dev = ["pytest>=8.0.0"]
```

- [ ] **Step 2: Create empty `__init__.py` files**

`python/csf-analysis/src/csf_analysis/__init__.py`: empty file for now.
`python/csf-analysis/tests/__init__.py`: empty file.

- [ ] **Step 3: Write the failing test for `TokenSpan`**

`python/csf-analysis/tests/test_token_span.py`:

```python
from csf_analysis.token_span import TokenSpan


def test_token_span_holds_text_and_is_word_like():
    span = TokenSpan(text="widget", is_word_like=True)
    assert span.text == "widget"
    assert span.is_word_like is True


def test_token_span_is_frozen():
    span = TokenSpan(text="widget", is_word_like=True)
    try:
        span.text = "other"
        raised = False
    except AttributeError:
        raised = True
    assert raised
```

- [ ] **Step 4: Run `uv sync` and run the test to verify it fails**

```bash
cd python/csf-analysis
uv sync
uv run pytest tests/test_token_span.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'csf_analysis.token_span'`.

- [ ] **Step 5: Implement `token_span.py`**

```python
from dataclasses import dataclass


@dataclass(frozen=True)
class TokenSpan:
    text: str
    is_word_like: bool
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
uv run pytest tests/test_token_span.py -v
```
Expected: PASS (2 passed).

- [ ] **Step 7: Commit**

```bash
git add python/csf-analysis/
git commit -m "feat(csf-analysis): scaffold package, add TokenSpan"
```

---

## Task 2: `segment_latin.py` — regex-based word segmenter (en/de)

Ports the `en`/`de` half of `packages/analysis/src/language-profile.ts`'s `segmentWithIntl()`. TypeScript uses `Intl.Segmenter` for word-boundary detection; Python has no stdlib equivalent, so this uses a Unicode-aware regex instead (a word = a run of Unicode letters/digits/marks, excluding `_`). Per the design doc, exact cross-implementation tokenization isn't the correctness bar — internal index-time/query-time consistency within one implementation is. This function **never emits non-word-like spans** (whitespace/punctuation runs) — unlike `Intl.Segmenter`, which emits them as `isWordLike: false` spans that `analyze()` then skips — because nothing downstream needs them; this is a deliberate simplification, not a bug.

**Files:**
- Create: `python/csf-analysis/src/csf_analysis/segment_latin.py`
- Test: `python/csf-analysis/tests/test_segment_latin.py`

**Interfaces:**
- Consumes: `TokenSpan` from `csf_analysis.token_span` (Task 1).
- Produces: `segment_latin_words(text: str) -> list[TokenSpan]`, used by `language_profile.py` (Task 6, as the `en`/`de` profiles' `segment` function) and by `segment_ngram.py` (Task 3, for non-script runs inside CJK/SEA text).

- [ ] **Step 1: Write the failing test**

```python
from csf_analysis.segment_latin import segment_latin_words
from csf_analysis.token_span import TokenSpan


def test_splits_on_whitespace():
    assert segment_latin_words("hello world") == [
        TokenSpan(text="hello", is_word_like=True),
        TokenSpan(text="world", is_word_like=True),
    ]


def test_splits_on_punctuation():
    assert segment_latin_words("widgets, gadgets.") == [
        TokenSpan(text="widgets", is_word_like=True),
        TokenSpan(text="gadgets", is_word_like=True),
    ]


def test_keeps_unicode_letters_together():
    assert segment_latin_words("café schön") == [
        TokenSpan(text="café", is_word_like=True),
        TokenSpan(text="schön", is_word_like=True),
    ]


def test_empty_string_yields_no_spans():
    assert segment_latin_words("") == []


def test_underscore_is_a_boundary_not_a_word_character():
    assert segment_latin_words("under_score") == [
        TokenSpan(text="under", is_word_like=True),
        TokenSpan(text="score", is_word_like=True),
    ]
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/test_segment_latin.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'csf_analysis.segment_latin'`.

- [ ] **Step 3: Implement `segment_latin.py`**

```python
import re

from csf_analysis.token_span import TokenSpan

# Unicode "word" characters (letters, digits, combining marks) excluding
# the underscore that \w normally includes -- "under_score" should split
# into two words, matching what Intl.Segmenter's word-boundary algorithm
# does for an underscore (not a letter/digit/mark) in practice.
_WORD_RE = re.compile(r"[^\W_]+", re.UNICODE)


def segment_latin_words(text: str) -> list[TokenSpan]:
    return [
        TokenSpan(text=match.group(0), is_word_like=True)
        for match in _WORD_RE.finditer(text)
    ]
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
uv run pytest tests/test_segment_latin.py -v
```
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add python/csf-analysis/src/csf_analysis/segment_latin.py python/csf-analysis/tests/test_segment_latin.py
git commit -m "feat(csf-analysis): add segment_latin_words (en/de word segmentation)"
```

---

## Task 3: `segment_ngram.py`, `segment_cjk.py`, `segment_sea.py`

Direct ports of `segment-ngram.ts`, `segment-cjk.ts`, `segment-sea.ts`. The shared n-gram windowing core segments a script run into overlapping n-character spans, and any interleaved non-script run through `segment_latin_words` (Task 2) — CJK/Thai/Khmer/Lao text routinely mixes in Latin words, digits, and punctuation.

**Files:**
- Create: `python/csf-analysis/src/csf_analysis/segment_ngram.py`
- Create: `python/csf-analysis/src/csf_analysis/segment_cjk.py`
- Create: `python/csf-analysis/src/csf_analysis/segment_sea.py`
- Test: `python/csf-analysis/tests/test_segment_cjk.py`
- Test: `python/csf-analysis/tests/test_segment_sea.py`

**Interfaces:**
- Consumes: `TokenSpan` (Task 1), `segment_latin_words` (Task 2).
- Produces: `segment_by_script_ngram(text: str, is_in_script: Callable[[str], bool], n: int) -> list[TokenSpan]` (internal, used by the two functions below); `segment_cjk_bigram(text: str) -> list[TokenSpan]`; `segment_sea_trigram(text: str) -> list[TokenSpan]` — both used by `language_profile.py` (Task 6).

- [ ] **Step 1: Write the failing tests**

`python/csf-analysis/tests/test_segment_cjk.py`:

```python
from csf_analysis.segment_cjk import segment_cjk_bigram
from csf_analysis.token_span import TokenSpan


def test_splits_a_run_of_cjk_characters_into_overlapping_bigrams():
    assert segment_cjk_bigram("自然語言") == [
        TokenSpan(text="自然", is_word_like=True),
        TokenSpan(text="然語", is_word_like=True),
        TokenSpan(text="語言", is_word_like=True),
    ]


def test_indexes_a_lone_single_character_cjk_run_as_that_one_character():
    assert segment_cjk_bigram("深") == [
        TokenSpan(text="深", is_word_like=True)
    ]


def test_segments_a_non_cjk_run_normally():
    spans = segment_cjk_bigram("深度learning")
    assert spans == [
        TokenSpan(text="深度", is_word_like=True),
        TokenSpan(text="learning", is_word_like=True),
    ]


def test_keeps_cjk_bigrams_and_latin_words_separate_across_whitespace():
    spans = segment_cjk_bigram("電腦 and 手機")
    assert [s.text for s in spans] == ["電腦", "and", "手機"]


def test_is_stable_across_repeated_calls():
    a = segment_cjk_bigram("自然語言處理")
    b = segment_cjk_bigram("自然語言處理")
    assert a == b


def test_returns_empty_list_for_empty_string():
    assert segment_cjk_bigram("") == []
```

`python/csf-analysis/tests/test_segment_sea.py`:

```python
from csf_analysis.segment_sea import segment_sea_trigram
from csf_analysis.token_span import TokenSpan


def test_splits_a_run_of_thai_characters_into_overlapping_trigrams():
    spans = segment_sea_trigram("สวัสดี")
    assert spans == [
        TokenSpan(text="สวั", is_word_like=True),
        TokenSpan(text="วัส", is_word_like=True),
        TokenSpan(text="ัสด", is_word_like=True),
        TokenSpan(text="สดี", is_word_like=True),
    ]


def test_indexes_a_short_run_below_trigram_width_as_one_span():
    assert segment_sea_trigram("กข") == [
        TokenSpan(text="กข", is_word_like=True)
    ]


def test_segments_a_non_sea_run_normally():
    spans = segment_sea_trigram("กขhello")
    assert spans[-1] == TokenSpan(text="hello", is_word_like=True)


def test_returns_empty_list_for_empty_string():
    assert segment_sea_trigram("") == []
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run pytest tests/test_segment_cjk.py tests/test_segment_sea.py -v
```
Expected: FAIL — `ModuleNotFoundError`.

- [ ] **Step 3: Implement `segment_ngram.py`**

```python
from typing import Callable

from csf_analysis.segment_latin import segment_latin_words
from csf_analysis.token_span import TokenSpan


def _segment_script_run(run: list[str], n: int) -> list[TokenSpan]:
    if len(run) < n:
        return [TokenSpan(text="".join(run), is_word_like=True)]
    spans: list[TokenSpan] = []
    for i in range(len(run) - n + 1):
        spans.append(TokenSpan(text="".join(run[i : i + n]), is_word_like=True))
    return spans


def segment_by_script_ngram(
    text: str, is_in_script: Callable[[str], bool], n: int
) -> list[TokenSpan]:
    chars = list(text)
    spans: list[TokenSpan] = []
    i = 0
    while i < len(chars):
        in_script = is_in_script(chars[i])
        j = i
        while j < len(chars) and is_in_script(chars[j]) == in_script:
            j += 1
        run = chars[i:j]
        if in_script:
            spans.extend(_segment_script_run(run, n))
        else:
            spans.extend(segment_latin_words("".join(run)))
        i = j
    return spans
```

- [ ] **Step 4: Implement `segment_cjk.py`**

```python
import re

from csf_analysis.segment_ngram import segment_by_script_ngram
from csf_analysis.token_span import TokenSpan

# Han ideographs (+ Extension A), hiragana, katakana -- deliberately
# excludes Hangul (Korean is whitespace-delimited at the word level) and
# Thai/Khmer/Lao (see segment_sea.py's own script ranges).
_CJK_CHAR = re.compile(r"[぀-ヿ㐀-䶿一-鿿]")


def _is_cjk(ch: str) -> bool:
    return bool(_CJK_CHAR.match(ch))


def segment_cjk_bigram(text: str) -> list[TokenSpan]:
    return segment_by_script_ngram(text, _is_cjk, 2)
```

- [ ] **Step 5: Implement `segment_sea.py`**

```python
import re

from csf_analysis.segment_ngram import segment_by_script_ngram
from csf_analysis.token_span import TokenSpan

# Thai (U+0E00-0E7F) + Lao (U+0E80-0EFF), a contiguous pair of blocks,
# plus Khmer (U+1780-17FF).
_SEA_CHAR = re.compile(r"[฀-໿ក-៿]")


def _is_sea(ch: str) -> bool:
    return bool(_SEA_CHAR.match(ch))


def segment_sea_trigram(text: str) -> list[TokenSpan]:
    return segment_by_script_ngram(text, _is_sea, 3)
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
uv run pytest tests/test_segment_cjk.py tests/test_segment_sea.py -v
```
Expected: PASS (10 passed).

- [ ] **Step 7: Commit**

```bash
git add python/csf-analysis/src/csf_analysis/segment_ngram.py python/csf-analysis/src/csf_analysis/segment_cjk.py python/csf-analysis/src/csf_analysis/segment_sea.py python/csf-analysis/tests/test_segment_cjk.py python/csf-analysis/tests/test_segment_sea.py
git commit -m "feat(csf-analysis): add CJK bigram / SEA trigram n-gram segmentation"
```

---

## Task 4: `stemmer_en.py` — classic Porter stemmer

Direct port of `packages/analysis/src/stemmer-en.ts` (the original 1980 Porter algorithm, not Porter2/Snowball). Verified against the same 23,531-word public reference vocabulary already checked into the repo.

**Files:**
- Create: `python/csf-analysis/src/csf_analysis/stemmer_en.py`
- Create: `python/csf-analysis/tests/fixtures/porter-input.txt` (copy of `packages/analysis/test/fixtures/porter-input.txt`)
- Create: `python/csf-analysis/tests/fixtures/porter-output.txt` (copy of `packages/analysis/test/fixtures/porter-output.txt`)
- Test: `python/csf-analysis/tests/test_stemmer_en.py`

**Interfaces:**
- Produces: `stem_english(word: str) -> str`, used by `language_profile.py` (Task 6) as the `en` profile's `stem`.

- [ ] **Step 1: Copy the reference vocabulary fixtures**

```bash
mkdir -p python/csf-analysis/tests/fixtures
cp packages/analysis/test/fixtures/porter-input.txt python/csf-analysis/tests/fixtures/porter-input.txt
cp packages/analysis/test/fixtures/porter-output.txt python/csf-analysis/tests/fixtures/porter-output.txt
```

- [ ] **Step 2: Write the failing test**

```python
from pathlib import Path

from csf_analysis.stemmer_en import stem_english

_FIXTURES = Path(__file__).parent / "fixtures"


def test_leaves_short_words_unchanged():
    assert stem_english("a") == "a"
    assert stem_english("is") == "is"


def test_leaves_non_ascii_letter_input_unchanged():
    assert stem_english("café") == "café"
    assert stem_english("2024") == "2024"


def test_strips_plural_and_inflectional_suffixes():
    assert stem_english("caresses") == "caress"
    assert stem_english("ponies") == "poni"
    assert stem_english("ties") == "ti"
    assert stem_english("caress") == "caress"
    assert stem_english("cats") == "cat"
    assert stem_english("feed") == "feed"
    assert stem_english("agreed") == "agre"
    assert stem_english("plastered") == "plaster"
    assert stem_english("motoring") == "motor"
    assert stem_english("hopping") == "hop"
    assert stem_english("tanned") == "tan"
    assert stem_english("falling") == "fall"
    assert stem_english("sized") == "size"


def test_converts_trailing_y_to_i_only_when_stem_has_a_vowel():
    assert stem_english("happy") == "happi"
    assert stem_english("sky") == "sky"


def test_does_not_strip_a_longer_nested_suffixes_shorter_alternative_on_condition_failure():
    # measure("agree") is 1, so neither "ement" (m>1) nor "ment" (m>1)
    # fires -- a naive implementation that falls through to the shorter
    # nested "ent" suffix would wrongly strip it anyway.
    assert stem_english("agreement") == "agreement"
    assert stem_english("argument") == "argument"
    assert stem_english("element") == "element"
    assert stem_english("implements") == "implement"


def test_uses_bli_to_ble_per_the_later_errata_and_adds_logi_to_log():
    assert stem_english("corruptibly") == "corrupt"
    assert stem_english("apology") == "apolog"


def test_matches_every_word_stem_pair_in_the_23531_word_porter_reference_vocabulary():
    words = _FIXTURES.joinpath("porter-input.txt").read_text().strip().split("\n")
    stems = _FIXTURES.joinpath("porter-output.txt").read_text().strip().split("\n")
    assert len(words) == len(stems)
    assert len(words) > 20000

    mismatches = []
    for word, expected in zip(words, stems):
        actual = stem_english(word)
        if actual != expected:
            mismatches.append(f'{word}: expected "{expected}", got "{actual}"')
    assert mismatches[:20] == []
    assert len(mismatches) == 0
```

- [ ] **Step 3: Run test to verify it fails**

```bash
uv run pytest tests/test_stemmer_en.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'csf_analysis.stemmer_en'`.

- [ ] **Step 4: Implement `stemmer_en.py`**

```python
import re
from dataclasses import dataclass
from typing import Callable

_VOWEL = re.compile(r"[aeiou]")


def _is_consonant(word: str, i: int) -> bool:
    if i < 0 or i >= len(word):
        return False
    c = word[i]
    if _VOWEL.match(c):
        return False
    if c != "y":
        return True
    return i == 0 or not _is_consonant(word, i - 1)


def _measure(word: str) -> int:
    i = 0
    n = len(word)
    while i < n and _is_consonant(word, i):
        i += 1
    m = 0
    while i < n:
        while i < n and not _is_consonant(word, i):
            i += 1
        if i >= n:
            break
        while i < n and _is_consonant(word, i):
            i += 1
        m += 1
    return m


def _has_vowel(word: str) -> bool:
    return any(not _is_consonant(word, i) for i in range(len(word)))


def _ends_double_consonant(word: str) -> bool:
    n = len(word)
    if n < 2:
        return False
    return (
        word[n - 1] == word[n - 2]
        and _is_consonant(word, n - 1)
        and _is_consonant(word, n - 2)
    )


def _ends_cvc(word: str) -> bool:
    n = len(word)
    if n < 3:
        return False
    last = word[n - 1]
    return (
        _is_consonant(word, n - 3)
        and not _is_consonant(word, n - 2)
        and _is_consonant(word, n - 1)
        and last not in ("w", "x", "y")
    )


@dataclass(frozen=True)
class _Rule:
    suffix: str
    replacement: str
    condition: Callable[[str], bool] | None = None


def _apply_rules(word: str, rules: list[_Rule]) -> str:
    for rule in rules:
        if not word.endswith(rule.suffix):
            continue
        stem = word[: len(word) - len(rule.suffix)]
        if rule.condition and not rule.condition(stem):
            return word
        return stem + rule.replacement
    return word


def _step1a(word: str) -> str:
    return _apply_rules(
        word,
        [
            _Rule("sses", "ss"),
            _Rule("ies", "i"),
            _Rule("ss", "ss"),
            _Rule("s", ""),
        ],
    )


def _restore_after_step1b(stem: str) -> str:
    if stem.endswith("at") or stem.endswith("bl") or stem.endswith("iz"):
        return stem + "e"
    if _ends_double_consonant(stem) and stem[-1] not in ("l", "s", "z"):
        return stem[:-1]
    if _measure(stem) == 1 and _ends_cvc(stem):
        return stem + "e"
    return stem


def _step1b(word: str) -> str:
    if word.endswith("eed"):
        stem = word[:-3]
        return stem + "ee" if _measure(stem) > 0 else word
    for suffix in ("ed", "ing"):
        if not word.endswith(suffix):
            continue
        stem = word[: len(word) - len(suffix)]
        if not _has_vowel(stem):
            continue
        return _restore_after_step1b(stem)
    return word


def _step1c(word: str) -> str:
    if not word.endswith("y"):
        return word
    stem = word[:-1]
    if len(stem) == 0 or not _has_vowel(stem):
        return word
    return stem + "i"


def _m0(stem: str) -> bool:
    return _measure(stem) > 0


def _step2(word: str) -> str:
    return _apply_rules(
        word,
        [
            _Rule("ational", "ate", _m0),
            _Rule("tional", "tion", _m0),
            _Rule("enci", "ence", _m0),
            _Rule("anci", "ance", _m0),
            _Rule("izer", "ize", _m0),
            _Rule("bli", "ble", _m0),
            _Rule("alli", "al", _m0),
            _Rule("entli", "ent", _m0),
            _Rule("eli", "e", _m0),
            _Rule("ousli", "ous", _m0),
            _Rule("ization", "ize", _m0),
            _Rule("ation", "ate", _m0),
            _Rule("ator", "ate", _m0),
            _Rule("alism", "al", _m0),
            _Rule("iveness", "ive", _m0),
            _Rule("fulness", "ful", _m0),
            _Rule("ousness", "ous", _m0),
            _Rule("aliti", "al", _m0),
            _Rule("iviti", "ive", _m0),
            _Rule("biliti", "ble", _m0),
            _Rule("logi", "log", _m0),
        ],
    )


def _step3(word: str) -> str:
    return _apply_rules(
        word,
        [
            _Rule("icate", "ic", _m0),
            _Rule("ative", "", _m0),
            _Rule("alize", "al", _m0),
            _Rule("iciti", "ic", _m0),
            _Rule("ical", "ic", _m0),
            _Rule("ful", "", _m0),
            _Rule("ness", "", _m0),
        ],
    )


def _m1(stem: str) -> bool:
    return _measure(stem) > 1


def _step4(word: str) -> str:
    return _apply_rules(
        word,
        [
            _Rule("al", "", _m1),
            _Rule("ance", "", _m1),
            _Rule("ence", "", _m1),
            _Rule("er", "", _m1),
            _Rule("ic", "", _m1),
            _Rule("able", "", _m1),
            _Rule("ible", "", _m1),
            _Rule("ant", "", _m1),
            _Rule("ement", "", _m1),
            _Rule("ment", "", _m1),
            _Rule("ent", "", _m1),
            _Rule(
                "ion",
                "",
                lambda stem: _m1(stem) and (stem.endswith("s") or stem.endswith("t")),
            ),
            _Rule("ou", "", _m1),
            _Rule("ism", "", _m1),
            _Rule("ate", "", _m1),
            _Rule("iti", "", _m1),
            _Rule("ous", "", _m1),
            _Rule("ive", "", _m1),
            _Rule("ize", "", _m1),
        ],
    )


def _step5a(word: str) -> str:
    if not word.endswith("e"):
        return word
    stem = word[:-1]
    m = _measure(stem)
    if m > 1 or (m == 1 and not _ends_cvc(stem)):
        return stem
    return word


def _step5b(word: str) -> str:
    if word.endswith("ll") and _measure(word[:-1]) > 1:
        return word[:-1]
    return word


_ASCII_LETTERS_ONLY = re.compile(r"^[a-z]+$")


def stem_english(word: str) -> str:
    if len(word) <= 2 or not _ASCII_LETTERS_ONLY.match(word):
        return word
    result = _step1a(word)
    result = _step1b(result)
    result = _step1c(result)
    result = _step2(result)
    result = _step3(result)
    result = _step4(result)
    result = _step5a(result)
    result = _step5b(result)
    return result
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
uv run pytest tests/test_stemmer_en.py -v
```
Expected: PASS (7 passed) — including the full 23,531-word reference vocabulary check.

- [ ] **Step 6: Commit**

```bash
git add python/csf-analysis/src/csf_analysis/stemmer_en.py python/csf-analysis/tests/test_stemmer_en.py python/csf-analysis/tests/fixtures/porter-input.txt python/csf-analysis/tests/fixtures/porter-output.txt
git commit -m "feat(csf-analysis): add classic Porter English stemmer"
```

---

## Task 5: `stemmer_de.py` — Snowball German stemmer

Direct port of `packages/analysis/src/stemmer-de.ts`. Verified against the same 35,053-word public reference vocabulary already checked into the repo.

**Files:**
- Create: `python/csf-analysis/src/csf_analysis/stemmer_de.py`
- Create: `python/csf-analysis/tests/fixtures/german-input.txt` (copy of `packages/analysis/test/fixtures/german-input.txt`)
- Create: `python/csf-analysis/tests/fixtures/german-output.txt` (copy of `packages/analysis/test/fixtures/german-output.txt`)
- Test: `python/csf-analysis/tests/test_stemmer_de.py`

**Interfaces:**
- Produces: `stem_german(word: str) -> str`, used by `language_profile.py` (Task 6) as the `de` profile's `stem`.

- [ ] **Step 1: Copy the reference vocabulary fixtures**

```bash
cp packages/analysis/test/fixtures/german-input.txt python/csf-analysis/tests/fixtures/german-input.txt
cp packages/analysis/test/fixtures/german-output.txt python/csf-analysis/tests/fixtures/german-output.txt
```

- [ ] **Step 2: Write the failing test**

```python
from pathlib import Path

from csf_analysis.stemmer_de import stem_german

_FIXTURES = Path(__file__).parent / "fixtures"


def test_folds_sharp_s_and_digraphs_to_umlauts_then_back_to_plain_vowels():
    # "bauen" -> the 'u' between two vowels marks as semivowel 'U', so
    # digraph folding leaves it alone; final postlude still folds it
    # back to plain 'u'.
    assert stem_german("bauen") == "bau"


def test_does_not_fold_ue_right_after_q():
    assert stem_german("quelle") == "quell"


def test_strips_a_trailing_apostrophe_possessive_form():
    assert stem_german("mandela's") == "mandela"


def test_leaves_empty_string_unchanged():
    assert stem_german("") == ""


def test_matches_every_word_stem_pair_in_the_35053_word_snowball_reference_vocabulary():
    words = _FIXTURES.joinpath("german-input.txt").read_text().strip().split("\n")
    stems = _FIXTURES.joinpath("german-output.txt").read_text().strip().split("\n")
    assert len(words) == len(stems)
    assert len(words) > 30000

    mismatches = []
    for word, expected in zip(words, stems):
        actual = stem_german(word)
        if actual != expected:
            mismatches.append(f'{word}: expected "{expected}", got "{actual}"')
    assert mismatches[:20] == []
    assert len(mismatches) == 0
```

- [ ] **Step 3: Run test to verify it fails**

```bash
uv run pytest tests/test_stemmer_de.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'csf_analysis.stemmer_de'`.

- [ ] **Step 4: Implement `stemmer_de.py`**

```python
_VOWELS = {"a", "e", "i", "o", "u", "y", "ä", "ö", "ü"}
_S_ENDING = {"b", "d", "f", "g", "h", "k", "l", "m", "n", "r", "t"}
_ST_ENDING = {"b", "d", "f", "g", "h", "k", "l", "m", "n", "t"}
_ET_ENDING = {"d", "f", "g", "k", "l", "m", "n", "r", "s", "t", "U", "z", "ä"}
_ET_EXCEPTIONS = ["geordn", "intern", "plan", "tick", "tr"]
_POSTLUDE_MAP = {"Y": "y", "U": "u", "ä": "a", "ö": "o", "ü": "u"}


def _is_vowel(ch: str | None) -> bool:
    return ch is not None and ch in _VOWELS


def _mark_semivowels(word: str) -> str:
    chars = list(word)
    for i in range(1, len(chars) - 1):
        c = chars[i]
        if c in ("u", "y") and _is_vowel(chars[i - 1]) and _is_vowel(chars[i + 1]):
            chars[i] = "U" if c == "u" else "Y"
    return "".join(chars)


def _fold_digraphs(word: str) -> str:
    result: list[str] = []
    i = 0
    n = len(word)
    while i < n:
        c = word[i]
        two = word[i : i + 2]
        if c == "ß":
            result.append("ss")
            i += 1
        elif two == "ae":
            result.append("ä")
            i += 2
        elif two == "oe":
            result.append("ö")
            i += 2
        elif two == "ue":
            result.append("ü")
            i += 2
        elif two == "qu":
            result.append("qu")
            i += 2
        else:
            result.append(c)
            i += 1
    return "".join(result)


def _find_region_start(word: str, start: int) -> int:
    length = len(word)
    i = start
    while i < length and not _is_vowel(word[i]):
        i += 1
    if i >= length:
        return length
    i += 1
    while i < length and _is_vowel(word[i]):
        i += 1
    if i >= length:
        return length
    i += 1
    return i


def _mark_regions(word: str) -> tuple[int, int]:
    raw_p1 = _find_region_start(word, 0)
    x = 3 if len(word) >= 3 else 0
    p1 = x if raw_p1 < x else raw_p1
    p2 = _find_region_start(word, raw_p1)
    return p1, p2


def _step1(word: str, p1: int) -> str:
    suffixes = ["erinnen", "erin", "ern", "lns", "em", "er", "en", "es", "ln", "e", "s"]
    matched = None
    start_idx = -1
    for suf in suffixes:
        if len(word) >= len(suf) and word.endswith(suf):
            idx = len(word) - len(suf)
            if idx >= p1:
                matched = suf
                start_idx = idx
                break
    if matched is None:
        return word
    if matched == "em":
        before = word[:start_idx]
        return word if before.endswith("syst") else before
    if matched in ("ern", "er", "erin", "erinnen"):
        return word[:start_idx]
    if matched in ("e", "en", "es"):
        result = word[:start_idx]
        if result.endswith("niss"):
            result = result[:-1]
        return result
    if matched == "s":
        before = word[:start_idx]
        last = before[-1] if before else ""
        return before if last in _S_ENDING else word
    if matched in ("ln", "lns"):
        return word[:start_idx] + "l"
    return word


def _step2(word: str, p1: int) -> str:
    suffixes = ["est", "en", "er", "st", "et"]
    matched = None
    start_idx = -1
    for suf in suffixes:
        if len(word) >= len(suf) and word.endswith(suf):
            idx = len(word) - len(suf)
            if idx >= p1:
                matched = suf
                start_idx = idx
                break
    if matched is None:
        return word
    if matched in ("en", "er", "est"):
        return word[:start_idx]
    if matched == "st":
        before = word[:start_idx]
        last = before[-1] if before else ""
        if last not in _ST_ENDING:
            return word
        return before if len(before) > 3 else word
    if matched == "et":
        before = word[:start_idx]
        last = before[-1] if before else ""
        if last not in _ET_ENDING:
            return word
        return word if any(before.endswith(exc) for exc in _ET_EXCEPTIONS) else before
    return word


def _step3(word: str, p1: int, p2: int) -> str:
    suffixes = ["isch", "lich", "heit", "keit", "end", "ung", "ig", "ik"]
    matched = None
    start_idx = -1
    for suf in suffixes:
        if len(word) >= len(suf) and word.endswith(suf):
            idx = len(word) - len(suf)
            if idx >= p2:
                matched = suf
                start_idx = idx
                break
    if matched is None:
        return word
    if matched in ("end", "ung"):
        result = word[:start_idx]
        if result.endswith("ig"):
            ig_start = len(result) - 2
            before_ig = result[:ig_start]
            last = before_ig[-1] if before_ig else ""
            if ig_start >= p2 and last != "e":
                result = before_ig
        return result
    if matched in ("ig", "ik", "isch"):
        before = word[:start_idx]
        last = before[-1] if before else ""
        return word if last == "e" else before
    if matched in ("lich", "heit"):
        result = word[:start_idx]
        for extra in ("er", "en"):
            if result.endswith(extra):
                idx2 = len(result) - len(extra)
                if idx2 >= p1:
                    result = result[:idx2]
                break
        return result
    if matched == "keit":
        result = word[:start_idx]
        for extra in ("lich", "ig"):
            if result.endswith(extra):
                idx2 = len(result) - len(extra)
                if idx2 >= p2:
                    result = result[:idx2]
                break
        return result
    return word


def _step4(word: str) -> str:
    for suf in ("'sch", "'s", "'"):
        if len(word) >= len(suf) and word.endswith(suf):
            before = word[: len(word) - len(suf)]
            return before if len(before) >= 2 else word
    return word


def _postlude(word: str) -> str:
    return "".join(_POSTLUDE_MAP.get(c, c) for c in word)


def stem_german(word: str) -> str:
    if len(word) == 0:
        return word
    w = _fold_digraphs(_mark_semivowels(word))
    p1, p2 = _mark_regions(w)
    w = _step1(w, p1)
    w = _step2(w, p1)
    w = _step3(w, p1, p2)
    w = _step4(w)
    return _postlude(w)
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
uv run pytest tests/test_stemmer_de.py -v
```
Expected: PASS (5 passed) — including the full 35,053-word reference vocabulary check.

- [ ] **Step 6: Commit**

```bash
git add python/csf-analysis/src/csf_analysis/stemmer_de.py python/csf-analysis/tests/test_stemmer_de.py python/csf-analysis/tests/fixtures/german-input.txt python/csf-analysis/tests/fixtures/german-output.txt
git commit -m "feat(csf-analysis): add Snowball German stemmer"
```

---

## Task 6: `language_profile.py` — `LanguageProfile` + the 7 profiles

Direct port of `packages/analysis/src/language-profile.ts`'s `LanguageProfile` interface, `stripDiacritics`, and the 7 exported profile constants (`english`, `german`, `chinese`, `japanese`, `thai`, `khmer`, `lao`).

**Files:**
- Create: `python/csf-analysis/src/csf_analysis/language_profile.py`
- Test: `python/csf-analysis/tests/test_language_profile.py`

**Interfaces:**
- Consumes: `TokenSpan` (Task 1), `segment_latin_words` (Task 2), `segment_cjk_bigram`/`segment_sea_trigram` (Task 3), `stem_english` (Task 4), `stem_german` (Task 5).
- Produces: `LanguageProfile` dataclass (`code: str`, `segment: Callable[[str], list[TokenSpan]]`, `fold_diacritics: bool`, `stopwords: frozenset[str]`, `stem: Callable[[str], str]`); module-level constants `english`, `german`, `chinese`, `japanese`, `thai`, `khmer`, `lao`; `strip_diacritics(term: str) -> str`. Used by `registry.py` (Task 7) and `analyze.py` (Task 9).

- [ ] **Step 1: Write the failing test**

```python
from csf_analysis.language_profile import (
    chinese,
    english,
    german,
    japanese,
    khmer,
    lao,
    strip_diacritics,
    thai,
)


def test_english_profile_stems_via_porter():
    assert english.code == "en"
    assert english.stem("running") == "run"
    assert english.fold_diacritics is False


def test_german_profile_stems_via_snowball():
    assert german.code == "de"
    assert german.stem("häuser") == "haus"


def test_cjk_profiles_stem_is_identity():
    assert chinese.code == "zh"
    assert chinese.stem("自然") == "自然"
    assert japanese.code == "ja"
    assert japanese.stem("こん") == "こん"


def test_sea_profiles_stem_is_identity():
    assert thai.code == "th"
    assert khmer.code == "km"
    assert lao.code == "lo"
    assert thai.stem("ทดสอบ") == "ทดสอบ"


def test_strip_diacritics_removes_combining_marks():
    assert strip_diacritics("café") == "cafe"
    assert strip_diacritics("straße") == "strasse" or strip_diacritics(
        "straße"
    ) == "straße"
    # ^ NFKD does not decompose ß into s+s (it isn't a diacritic mark),
    # so stripping combining marks alone leaves it unchanged -- this
    # assertion documents that, rather than asserting a false claim.


def test_segment_is_callable_and_returns_token_spans():
    spans = english.segment("widgets")
    assert len(spans) == 1
    assert spans[0].text == "widgets"
    assert spans[0].is_word_like is True
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/test_language_profile.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'csf_analysis.language_profile'`.

- [ ] **Step 3: Implement `language_profile.py`**

```python
import unicodedata
from dataclasses import dataclass
from typing import Callable

from csf_analysis.segment_cjk import segment_cjk_bigram
from csf_analysis.segment_latin import segment_latin_words
from csf_analysis.segment_sea import segment_sea_trigram
from csf_analysis.stemmer_de import stem_german as _stem_german
from csf_analysis.stemmer_en import stem_english as _stem_english
from csf_analysis.token_span import TokenSpan


@dataclass(frozen=True)
class LanguageProfile:
    code: str
    segment: Callable[[str], list[TokenSpan]]
    fold_diacritics: bool
    stopwords: frozenset
    stem: Callable[[str], str]


def strip_diacritics(term: str) -> str:
    decomposed = unicodedata.normalize("NFKD", term)
    return "".join(c for c in decomposed if not unicodedata.category(c).startswith("M"))


def _identity(term: str) -> str:
    return term


english = LanguageProfile(
    code="en",
    segment=segment_latin_words,
    fold_diacritics=False,
    stopwords=frozenset(),
    stem=_stem_english,
)

german = LanguageProfile(
    code="de",
    segment=segment_latin_words,
    fold_diacritics=False,
    stopwords=frozenset(),
    stem=_stem_german,
)

chinese = LanguageProfile(
    code="zh",
    segment=segment_cjk_bigram,
    fold_diacritics=False,
    stopwords=frozenset(),
    stem=_identity,
)

japanese = LanguageProfile(
    code="ja",
    segment=segment_cjk_bigram,
    fold_diacritics=False,
    stopwords=frozenset(),
    stem=_identity,
)

thai = LanguageProfile(
    code="th",
    segment=segment_sea_trigram,
    fold_diacritics=False,
    stopwords=frozenset(),
    stem=_identity,
)

khmer = LanguageProfile(
    code="km",
    segment=segment_sea_trigram,
    fold_diacritics=False,
    stopwords=frozenset(),
    stem=_identity,
)

lao = LanguageProfile(
    code="lo",
    segment=segment_sea_trigram,
    fold_diacritics=False,
    stopwords=frozenset(),
    stem=_identity,
)
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
uv run pytest tests/test_language_profile.py -v
```
Expected: PASS (6 passed).

- [ ] **Step 5: Commit**

```bash
git add python/csf-analysis/src/csf_analysis/language_profile.py python/csf-analysis/tests/test_language_profile.py
git commit -m "feat(csf-analysis): add LanguageProfile and the 7 registered profiles"
```

---

## Task 7: `registry.py`

Direct port of `packages/analysis/src/registry.ts`, minus `ownProp()` (unneeded — see Global Constraints).

**Files:**
- Create: `python/csf-analysis/src/csf_analysis/registry.py`
- Test: `python/csf-analysis/tests/test_registry.py`

**Interfaces:**
- Consumes: the 7 profile constants + `LanguageProfile` from `language_profile.py` (Task 6).
- Produces: `get_language_profile(code: str) -> LanguageProfile` (raises `ValueError` for an unregistered code); `get_registered_language_codes() -> list[str]`. Both used by `analyze.py` callers in `csf-indexer` (Task 15).

- [ ] **Step 1: Write the failing test**

```python
import pytest

from csf_analysis.language_profile import english
from csf_analysis.registry import get_language_profile, get_registered_language_codes


def test_get_language_profile_returns_the_registered_profile():
    assert get_language_profile("en") is english


def test_get_language_profile_raises_for_unregistered_code():
    with pytest.raises(ValueError, match='no LanguageProfile registered for "xx"'):
        get_language_profile("xx")


def test_get_registered_language_codes_lists_all_seven():
    codes = get_registered_language_codes()
    assert set(codes) == {"en", "de", "zh", "ja", "th", "km", "lo"}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/test_registry.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'csf_analysis.registry'`.

- [ ] **Step 3: Implement `registry.py`**

```python
from csf_analysis.language_profile import (
    LanguageProfile,
    chinese,
    english,
    german,
    japanese,
    khmer,
    lao,
    thai,
)

# The one place indexer and runtime both look up a LanguageProfile by
# code, so "is language X supported" can never answer differently on
# the two sides. Plain dict lookups are safe here (unlike the TS
# original's ownProp() guard) -- Python dicts have no prototype chain
# for an attacker-controlled key like "constructor" to walk.
_PROFILES: dict[str, LanguageProfile] = {
    "en": english,
    "de": german,
    "zh": chinese,
    "ja": japanese,
    "th": thai,
    "km": khmer,
    "lo": lao,
}


def get_language_profile(code: str) -> LanguageProfile:
    profile = _PROFILES.get(code)
    if profile is None:
        raise ValueError(f'no LanguageProfile registered for "{code}"')
    return profile


def get_registered_language_codes() -> list[str]:
    return list(_PROFILES.keys())
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
uv run pytest tests/test_registry.py -v
```
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add python/csf-analysis/src/csf_analysis/registry.py python/csf-analysis/tests/test_registry.py
git commit -m "feat(csf-analysis): add language profile registry"
```

---

## Task 8: `detect_language.py`

Direct port of `packages/analysis/src/detect-language.ts`. The one adaptation: TS's `\p{L}` (Unicode letter category) has no direct `re` equivalent without a third-party module, so this uses `str.isalpha()` (character-level) and a `[^\W\d_]+` regex (word-level) instead — both are standard, well-precedented Unicode-letter approximations.

**Files:**
- Create: `python/csf-analysis/src/csf_analysis/detect_language.py`
- Test: `python/csf-analysis/tests/test_detect_language.py`

**Interfaces:**
- Produces: `detect_language(text: str, candidate_codes: list[str]) -> str | None`, used by `extract.py` in `csf-indexer` (Task 13).

- [ ] **Step 1: Write the failing test**

```python
from csf_analysis.detect_language import detect_language


def test_detects_english_via_marker_words():
    text = "The quick brown fox is with the lazy dog and this is a test"
    assert detect_language(text, ["en", "de"]) == "en"


def test_detects_german_via_marker_words():
    text = "Das ist ein Test und die Katze ist auf dem Tisch sich mit"
    assert detect_language(text, ["en", "de"]) == "de"


def test_detects_japanese_via_kana_script_dominance():
    text = "こんにちは世界"
    assert detect_language(text, ["en", "ja", "zh"]) == "ja"


def test_detects_chinese_via_han_script_with_no_kana():
    text = "你好世界这是中文"
    assert detect_language(text, ["en", "ja", "zh"]) == "zh"


def test_returns_none_when_script_detected_but_not_offered_as_a_candidate():
    text = "こんにちは世界"
    assert detect_language(text, ["en", "zh"]) is None


def test_returns_none_with_no_confident_signal():
    assert detect_language("xyz 123", ["en", "de"]) is None


def test_returns_none_on_a_tie():
    # Equal marker-word counts for en and de -- no confident winner.
    text = "the and der und"
    assert detect_language(text, ["en", "de"]) is None
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/test_detect_language.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'csf_analysis.detect_language'`.

- [ ] **Step 3: Implement `detect_language.py`**

```python
import re

_HIRAGANA_KATAKANA = re.compile(r"[぀-ヿ]")
_HAN = re.compile(r"[㐀-䶿一-鿿]")
_THAI = re.compile(r"[฀-๿]")
_LAO = re.compile(r"[຀-໿]")
_KHMER = re.compile(r"[ក-៿]")

# Fraction of "letter-ish" characters that must be a given script before
# this module trusts a script-based classification over Latin scoring.
_SCRIPT_THRESHOLD = 0.3

_LATIN_MARKER_WORDS: dict[str, set[str]] = {
    "en": {
        "the", "and", "of", "to", "is", "in", "that", "for", "with", "as",
        "was", "are", "this", "have", "from", "by", "an", "be", "or", "on",
    },
    "de": {
        "der", "die", "das", "und", "ist", "nicht", "mit", "für", "auf",
        "sich", "den", "dem", "eine", "einen", "ein", "zu", "von", "im",
        "auch", "sind",
    },
}

# Approximates \p{L}+ (TS) via a Unicode word-character class minus
# digits/underscore -- Python's stdlib `re` has no \p{L} without a
# third-party module.
_WORD_TOKEN_RE = re.compile(r"[^\W\d_]+", re.UNICODE)


def _count_script_chars(text: str) -> dict:
    han = kana = thai = lao = khmer = letters = 0
    for ch in text:
        if not ch.isalpha():
            continue
        letters += 1
        if _HIRAGANA_KATAKANA.match(ch):
            kana += 1
        elif _HAN.match(ch):
            han += 1
        elif _THAI.match(ch):
            thai += 1
        elif _LAO.match(ch):
            lao += 1
        elif _KHMER.match(ch):
            khmer += 1
    return {"han": han, "kana": kana, "thai": thai, "lao": lao, "khmer": khmer, "letters": letters}


def _count_marker_words(text: str, words: set[str]) -> int:
    count = 0
    for token in _WORD_TOKEN_RE.findall(text.lower()):
        if token in words:
            count += 1
    return count


def detect_language(text: str, candidate_codes: list[str]) -> str | None:
    candidates = set(candidate_codes)
    counts = _count_script_chars(text)
    letters = counts["letters"]
    if letters > 0:
        if (counts["han"] + counts["kana"]) / letters >= _SCRIPT_THRESHOLD:
            cjk_code = "ja" if counts["kana"] > 0 else "zh"
            return cjk_code if cjk_code in candidates else None
        if counts["thai"] / letters >= _SCRIPT_THRESHOLD:
            return "th" if "th" in candidates else None
        if counts["lao"] / letters >= _SCRIPT_THRESHOLD:
            return "lo" if "lo" in candidates else None
        if counts["khmer"] / letters >= _SCRIPT_THRESHOLD:
            return "km" if "km" in candidates else None

    best_code: str | None = None
    best_count = 0
    tied = False
    for code in candidates:
        words = _LATIN_MARKER_WORDS.get(code)
        if not words:
            continue
        count = _count_marker_words(text, words)
        if count == 0:
            continue
        if count > best_count:
            best_code = code
            best_count = count
            tied = False
        elif count == best_count:
            tied = True
    return None if tied else best_code
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
uv run pytest tests/test_detect_language.py -v
```
Expected: PASS (7 passed).

- [ ] **Step 5: Commit**

```bash
git add python/csf-analysis/src/csf_analysis/detect_language.py python/csf-analysis/tests/test_detect_language.py
git commit -m "feat(csf-analysis): add script-range + marker-word language detection"
```

---

## Task 9: `analyze.py`

Direct port of `packages/analysis/src/analyze.ts`'s `analyze()` and `normalizePhrase()` — the one analysis pipeline shared by index-time and query-time code.

**Files:**
- Create: `python/csf-analysis/src/csf_analysis/analyze.py`
- Test: `python/csf-analysis/tests/test_analyze.py`

**Interfaces:**
- Consumes: `LanguageProfile`, `strip_diacritics` (Task 6).
- Produces: `Token(term: str, position: int, literal: str)` dataclass; `analyze(text: str, profile: LanguageProfile) -> list[Token]`; `normalize_phrase(text: str, profile: LanguageProfile) -> str`. Both used throughout `csf-indexer` (Task 15).

- [ ] **Step 1: Write the failing test**

```python
from csf_analysis.analyze import analyze, normalize_phrase
from csf_analysis.language_profile import english, german


def test_analyze_lowercases_and_stems():
    tokens = analyze("Running Widgets", english)
    assert [t.term for t in tokens] == ["run", "widget"]
    assert [t.literal for t in tokens] == ["running", "widgets"]
    assert [t.position for t in tokens] == [0, 1]


def test_analyze_normalizes_nfkc():
    # NFKC-normalizes before segmenting -- a decomposed character
    # (e.g. combining acute accent) collapses to its precomposed form.
    tokens = analyze("café", english)  # e + combining acute accent
    assert tokens[0].literal == "café"


def test_analyze_returns_empty_list_for_empty_string():
    assert analyze("", english) == []


def test_analyze_german_stems_via_snowball():
    tokens = analyze("Häuser", german)
    assert tokens[0].term == "haus"


def test_normalize_phrase_joins_stemmed_terms_with_a_space():
    assert normalize_phrase("Running Widgets", english) == "run widget"


def test_normalize_phrase_is_stable_for_case_variation():
    assert normalize_phrase("New York", english) == normalize_phrase(
        "new york", english
    )
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/test_analyze.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'csf_analysis.analyze'`.

- [ ] **Step 3: Implement `analyze.py`**

```python
import unicodedata
from dataclasses import dataclass

from csf_analysis.language_profile import LanguageProfile, strip_diacritics


@dataclass(frozen=True)
class Token:
    term: str
    position: int
    literal: str


def analyze(text: str, profile: LanguageProfile) -> list[Token]:
    normalized = unicodedata.normalize("NFKC", text)
    tokens: list[Token] = []
    position = 0

    for span in profile.segment(normalized):
        if not span.is_word_like:
            continue

        literal = span.text.lower()
        if profile.fold_diacritics:
            literal = strip_diacritics(literal)
        if literal in profile.stopwords:
            continue

        term = profile.stem(literal)
        tokens.append(Token(term=term, position=position, literal=literal))
        position += 1

    return tokens


def normalize_phrase(text: str, profile: LanguageProfile) -> str:
    return " ".join(t.term for t in analyze(text, profile))
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
uv run pytest tests/test_analyze.py -v
```
Expected: PASS (6 passed).

- [ ] **Step 5: Commit**

```bash
git add python/csf-analysis/src/csf_analysis/analyze.py python/csf-analysis/tests/test_analyze.py
git commit -m "feat(csf-analysis): add the shared analyze()/normalize_phrase() pipeline"
```

---

## Task 10: `is_rtl.py` + public `__init__.py` exports

Direct port of `packages/analysis/src/is-rtl.ts`, plus the package's public API surface (mirroring `packages/analysis/src/index.ts`).

**Files:**
- Create: `python/csf-analysis/src/csf_analysis/is_rtl.py`
- Modify: `python/csf-analysis/src/csf_analysis/__init__.py`
- Test: `python/csf-analysis/tests/test_is_rtl.py`
- Test: `python/csf-analysis/tests/test_public_api.py`

**Interfaces:**
- Produces: `is_rtl_language(code: str) -> bool`. Also finalizes `csf_analysis`'s public exports for `csf-indexer` (Task 11 onward) to import from.

- [ ] **Step 1: Write the failing tests**

`python/csf-analysis/tests/test_is_rtl.py`:

```python
from csf_analysis.is_rtl import is_rtl_language


def test_detects_arabic_and_hebrew_as_rtl():
    assert is_rtl_language("ar") is True
    assert is_rtl_language("he") is True


def test_detects_ltr_languages_as_not_rtl():
    assert is_rtl_language("en") is False
    assert is_rtl_language("de") is False


def test_compares_only_the_primary_subtag():
    assert is_rtl_language("ar-EG") is True
    assert is_rtl_language("en-US") is False


def test_is_case_insensitive():
    assert is_rtl_language("AR") is True
```

`python/csf-analysis/tests/test_public_api.py`:

```python
import csf_analysis


def test_exports_the_full_public_api():
    assert csf_analysis.analyze is not None
    assert csf_analysis.normalize_phrase is not None
    assert csf_analysis.detect_language is not None
    assert csf_analysis.is_rtl_language is not None
    assert csf_analysis.get_language_profile is not None
    assert csf_analysis.get_registered_language_codes is not None
    assert csf_analysis.stem_english is not None
    assert csf_analysis.stem_german is not None
    assert csf_analysis.segment_cjk_bigram is not None
    assert csf_analysis.segment_sea_trigram is not None
    assert csf_analysis.strip_diacritics is not None
    for name in ("english", "german", "chinese", "japanese", "thai", "khmer", "lao"):
        assert getattr(csf_analysis, name).code


def test_registry_and_direct_profile_imports_agree():
    assert csf_analysis.get_language_profile("en") is csf_analysis.english
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run pytest tests/test_is_rtl.py tests/test_public_api.py -v
```
Expected: FAIL — `is_rtl.py` doesn't exist, and `csf_analysis`'s `__init__.py` is still empty.

- [ ] **Step 3: Implement `is_rtl.py`**

```python
_RTL_LANGUAGE_CODES = {"ar", "he", "fa", "ur", "ps", "sd", "yi", "dv", "ku", "ckb"}


def is_rtl_language(code: str) -> bool:
    primary_subtag = code.split("-")[0].lower() if code else ""
    return primary_subtag in _RTL_LANGUAGE_CODES
```

- [ ] **Step 4: Implement `__init__.py`**

```python
from csf_analysis.analyze import Token, analyze, normalize_phrase
from csf_analysis.detect_language import detect_language
from csf_analysis.is_rtl import is_rtl_language
from csf_analysis.language_profile import (
    LanguageProfile,
    chinese,
    english,
    german,
    japanese,
    khmer,
    lao,
    strip_diacritics,
    thai,
)
from csf_analysis.registry import get_language_profile, get_registered_language_codes
from csf_analysis.segment_cjk import segment_cjk_bigram
from csf_analysis.segment_sea import segment_sea_trigram
from csf_analysis.stemmer_de import stem_german
from csf_analysis.stemmer_en import stem_english
from csf_analysis.token_span import TokenSpan

__all__ = [
    "Token",
    "analyze",
    "normalize_phrase",
    "detect_language",
    "is_rtl_language",
    "LanguageProfile",
    "TokenSpan",
    "chinese",
    "english",
    "german",
    "japanese",
    "khmer",
    "lao",
    "strip_diacritics",
    "thai",
    "get_language_profile",
    "get_registered_language_codes",
    "segment_cjk_bigram",
    "segment_sea_trigram",
    "stem_german",
    "stem_english",
]
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
uv run pytest -v
```
Expected: PASS — every test in the package, including all prior tasks' tests (should be 40+ passed at this point).

- [ ] **Step 6: Commit**

```bash
git add python/csf-analysis/src/csf_analysis/is_rtl.py python/csf-analysis/src/csf_analysis/__init__.py python/csf-analysis/tests/test_is_rtl.py python/csf-analysis/tests/test_public_api.py
git commit -m "feat(csf-analysis): add is_rtl_language, finalize public API exports"
```

This completes `csf-analysis` (Phase 1).

---

## Task 11: `csf-indexer` package scaffold + `hash.py` + `types.py`

**Files:**
- Create: `python/csf-indexer/pyproject.toml`
- Create: `python/csf-indexer/src/csf_indexer/__init__.py` (empty for now)
- Create: `python/csf-indexer/src/csf_indexer/hash.py`
- Create: `python/csf-indexer/src/csf_indexer/types.py`
- Create: `python/csf-indexer/tests/__init__.py` (empty)
- Test: `python/csf-indexer/tests/test_hash.py`
- Test: `python/csf-indexer/tests/test_types.py`

**Interfaces:**
- Produces: `content_hash(content: str | bytes) -> str` (8-char hex SHA-256 prefix); `SourceDocument(id: int, url: str, html: str)`, `PinDeclaration(phrase: str, mode: str, priority: float, exclusive: bool)`, `ExtractedDocument(...)`, `BuiltIndex(manifest: dict, term_shards: dict, doc_store: dict, id_range: tuple[int, int])` dataclasses — used by every subsequent `csf-indexer` task.

- [ ] **Step 1: Create the package directory and `pyproject.toml`**

```toml
[project]
name = "csf-indexer"
version = "0.1.0"
description = "Reference index-builder for client-search-framework (Python port of the lexical-core subset of @csf/indexer)."
requires-python = ">=3.10"
dependencies = [
    "csf-analysis",
    "selectolax>=0.3.21",
]

[project.scripts]
csf-indexer = "csf_indexer.cli:main"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/csf_indexer"]

[tool.uv.sources]
csf-analysis = { path = "../csf-analysis", editable = true }

[dependency-groups]
dev = ["pytest>=8.0.0", "jsonschema>=4.23.0"]
```

- [ ] **Step 2: Create empty `__init__.py` files**

`python/csf-indexer/src/csf_indexer/__init__.py`: empty.
`python/csf-indexer/tests/__init__.py`: empty.

- [ ] **Step 3: Write the failing tests**

`python/csf-indexer/tests/test_hash.py`:

```python
from csf_indexer.hash import content_hash


def test_hash_is_8_hex_characters():
    h = content_hash("hello")
    assert len(h) == 8
    assert all(c in "0123456789abcdef" for c in h)


def test_hash_is_deterministic():
    assert content_hash("hello") == content_hash("hello")


def test_hash_differs_for_different_content():
    assert content_hash("hello") != content_hash("world")


def test_hash_accepts_bytes():
    assert content_hash(b"hello") == content_hash("hello")
```

`python/csf-indexer/tests/test_types.py`:

```python
from csf_indexer.types import BuiltIndex, ExtractedDocument, PinDeclaration, SourceDocument


def test_source_document_holds_id_url_html():
    doc = SourceDocument(id=1, url="/foo", html="<html></html>")
    assert doc.id == 1
    assert doc.url == "/foo"


def test_pin_declaration_fields():
    pin = PinDeclaration(phrase="widgets", mode="exact", priority=0.0, exclusive=False)
    assert pin.mode == "exact"


def test_extracted_document_fields():
    doc = ExtractedDocument(
        title="Widgets",
        language="en",
        body="Our widgets are great.",
        excerpt="",
        url="/widgets",
        noindex=False,
        boost=1.0,
        facets={},
        range_facets={},
        pins=[],
    )
    assert doc.title == "Widgets"
    assert doc.pins == []


def test_built_index_fields():
    built = BuiltIndex(manifest={"version": 1}, term_shards={}, doc_store={}, id_range=(0, 0))
    assert built.manifest["version"] == 1
    assert built.id_range == (0, 0)
```

- [ ] **Step 4: Run `uv sync` and run tests to verify they fail**

```bash
cd python/csf-indexer
uv sync
uv run pytest -v
```
Expected: FAIL — `ModuleNotFoundError` for both `csf_indexer.hash` and `csf_indexer.types`.

- [ ] **Step 5: Implement `hash.py`**

```python
import hashlib


def content_hash(content: str | bytes) -> str:
    data = content.encode("utf-8") if isinstance(content, str) else content
    return hashlib.sha256(data).hexdigest()[:8]
```

- [ ] **Step 6: Implement `types.py`**

```python
from dataclasses import dataclass, field


@dataclass
class SourceDocument:
    id: int
    url: str
    html: str


@dataclass
class PinDeclaration:
    phrase: str
    mode: str  # "exact" | "contains"
    priority: float
    exclusive: bool


@dataclass
class ExtractedDocument:
    title: str
    language: str
    body: str
    excerpt: str
    url: str
    noindex: bool
    boost: float
    facets: dict[str, list[str]] = field(default_factory=dict)
    range_facets: dict[str, float] = field(default_factory=dict)
    pins: list[PinDeclaration] = field(default_factory=list)


@dataclass
class BuiltIndex:
    manifest: dict
    term_shards: dict[str, dict]
    doc_store: dict
    id_range: tuple[int, int]
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
uv run pytest -v
```
Expected: PASS (8 passed).

- [ ] **Step 8: Commit**

```bash
git add python/csf-indexer/
git commit -m "feat(csf-indexer): scaffold package, add content_hash and dataclasses"
```

---

## Task 12: `discover.py`

Direct port of `packages/indexer/src/discover.ts`.

**Files:**
- Create: `python/csf-indexer/src/csf_indexer/discover.py`
- Test: `python/csf-indexer/tests/test_discover.py`

**Interfaces:**
- Consumes: `SourceDocument` (Task 11).
- Produces: `discover_html_documents(root_dir: str) -> list[SourceDocument]`, used by `cli.py` (Task 17).

- [ ] **Step 1: Write the failing test**

```python
from pathlib import Path

from csf_indexer.discover import discover_html_documents


def test_discovers_html_files_recursively_with_sorted_stable_ids(tmp_path: Path):
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "a.html").write_text("<html><body>A</body></html>")
    (tmp_path / "docs" / "b.html").write_text("<html><body>B</body></html>")
    (tmp_path / "readme.html").write_text("<html><body>R</body></html>")
    (tmp_path / "readme.txt").write_text("not html")

    sources = discover_html_documents(str(tmp_path))

    assert len(sources) == 3
    urls = sorted(s.url for s in sources)
    assert urls == ["/docs/a", "/docs/b", "/readme"]
    ids = [s.id for s in sources]
    assert ids == sorted(ids)
    assert ids == list(range(len(sources)))


def test_reads_html_content(tmp_path: Path):
    (tmp_path / "page.html").write_text("<html><body>Hello</body></html>")
    sources = discover_html_documents(str(tmp_path))
    assert "Hello" in sources[0].html


def test_returns_empty_list_for_a_directory_with_no_html_files(tmp_path: Path):
    (tmp_path / "readme.txt").write_text("not html")
    assert discover_html_documents(str(tmp_path)) == []
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/test_discover.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'csf_indexer.discover'`.

- [ ] **Step 3: Implement `discover.py`**

```python
from pathlib import Path

from csf_indexer.types import SourceDocument


def _find_html_files(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*.html") if p.is_file())


def discover_html_documents(root_dir: str) -> list[SourceDocument]:
    root = Path(root_dir)
    files = _find_html_files(root)
    sources: list[SourceDocument] = []
    for doc_id, file in enumerate(files):
        html = file.read_text(encoding="utf-8")
        rel = file.relative_to(root).with_suffix("")
        url = "/" + rel.as_posix()
        sources.append(SourceDocument(id=doc_id, url=url, html=html))
    return sources
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
uv run pytest tests/test_discover.py -v
```
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add python/csf-indexer/src/csf_indexer/discover.py python/csf-indexer/tests/test_discover.py
git commit -m "feat(csf-indexer): add discover_html_documents"
```

---

## Task 13: `extract.py` part 1 — title/body/language/excerpt/canonical/noindex/boost

Ports the non-facet/pin half of `packages/indexer/src/extract.ts`. Uses `selectolax` for HTML parsing (CSS-selector querying, text extraction, node removal).

**Files:**
- Create: `python/csf-indexer/src/csf_indexer/extract.py`
- Test: `python/csf-indexer/tests/test_extract.py`

**Interfaces:**
- Consumes: `ExtractedDocument`, `PinDeclaration` (Task 11); `detect_language`, `get_registered_language_codes` (from `csf_analysis`).
- Produces: `extract_document(html: str, source_url: str, default_language: str = "en", allowed_url_origins: list[str] | None = None, canonical_base_url: str | None = None) -> ExtractedDocument` — with `facets`/`range_facets`/`pins` populated (Task 14 adds their test coverage; the parsing logic ships together in this task since it's cheap to include once the function's shape exists, but is not asserted on here).

- [ ] **Step 1: Write the failing test**

```python
from csf_indexer.extract import extract_document


def test_extracts_title_and_body():
    html = """
    <html lang="en">
      <head><title>Widgets</title></head>
      <body><main><p>Our widgets are wonderful.</p></main></body>
    </html>
    """
    doc = extract_document(html, "/widgets")
    assert doc.title == "Widgets"
    assert "wonderful" in doc.body
    assert doc.language == "en"


def test_strips_boilerplate_elements_from_body():
    html = """
    <html lang="en">
      <head><title>T</title></head>
      <body>
        <main>
          <nav>Skip this nav</nav>
          <p>Real content.</p>
          <footer>Skip this footer</footer>
        </main>
      </body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert "Real content" in doc.body
    assert "Skip this nav" not in doc.body
    assert "Skip this footer" not in doc.body


def test_prefers_data_csf_body_over_main_over_body():
    html = """
    <html lang="en">
      <head><title>T</title></head>
      <body>
        <main>Not this</main>
        <div data-csf-body>This is the real content</div>
      </body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert "This is the real content" in doc.body
    assert "Not this" not in doc.body


def test_falls_back_to_detected_language_when_no_html_lang():
    html = """
    <html>
      <head><title>Test</title></head>
      <body><main><p>The quick brown fox is with the lazy dog and this is a test</p></main></body>
    </html>
    """
    doc = extract_document(html, "/page", default_language="en")
    assert doc.language == "en"


def test_noindex_meta_tag_sets_noindex_true():
    html = """
    <html lang="en">
      <head><title>T</title><meta name="csf-noindex" content="true"></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert doc.noindex is True


def test_boost_meta_tag_parses_a_positive_float():
    html = """
    <html lang="en">
      <head><title>T</title><meta name="csf-boost" content="2.5"></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert doc.boost == 2.5


def test_invalid_boost_falls_back_to_1():
    html = """
    <html lang="en">
      <head><title>T</title><meta name="csf-boost" content="not-a-number"></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert doc.boost == 1.0


def test_canonical_link_overrides_source_url():
    html = """
    <html lang="en">
      <head><title>T</title><link rel="canonical" href="https://example.com/real-url"></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page", allowed_url_origins=["https://example.com"])
    assert doc.url == "https://example.com/real-url"


def test_canonical_link_off_allowlist_falls_back_to_source_url():
    html = """
    <html lang="en">
      <head><title>T</title><link rel="canonical" href="https://evil.com/real-url"></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page", allowed_url_origins=["https://example.com"])
    assert doc.url == "/page"


def test_root_relative_canonical_is_accepted_as_is():
    html = """
    <html lang="en">
      <head><title>T</title><link rel="canonical" href="/canonical-path"></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert doc.url == "/canonical-path"


def test_javascript_scheme_canonical_is_rejected():
    html = """
    <html lang="en">
      <head><title>T</title><link rel="canonical" href="javascript:alert(1)"></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert doc.url == "/page"


def test_excerpt_from_meta_description():
    html = """
    <html lang="en">
      <head><title>T</title><meta name="description" content="A short summary."></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert doc.excerpt == "A short summary."
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/test_extract.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'csf_indexer.extract'`.

- [ ] **Step 3: Implement `extract.py`**

```python
import math
import re
import sys
from urllib.parse import urljoin, urlparse

from selectolax.parser import HTMLParser

from csf_analysis import detect_language, get_registered_language_codes
from csf_indexer.types import ExtractedDocument, PinDeclaration

_FACET_TAG_PREFIX = "csf-facet-"
_RANGE_FACET_TAG_PREFIX = "csf-facet-range-"
_BOILERPLATE_SELECTORS = ["nav", "header", "footer", "aside", "script", "style"]
_SAFE_URL_PROTOCOLS = {"http", "https"}
_WHITESPACE_RE = re.compile(r"\s+")


def _collapse_whitespace(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", text).strip()


def _parse_float_or_nan(raw: str | None) -> float:
    if not raw:
        return float("nan")
    try:
        return float(raw)
    except ValueError:
        return float("nan")


def _warn(message: str) -> None:
    print(f"[csf-indexer] {message}", file=sys.stderr)


def _sanitize_canonical_url(
    canonical: str,
    source_url: str,
    allowed_url_origins: list[str] | None,
    base_url: str | None,
) -> str:
    if not canonical:
        return source_url

    # Root-relative paths have no scheme to exploit and need no base to
    # resolve. Protocol-relative ("//evil.com/foo") is deliberately
    # excluded from this fast path (its second character is also "/")
    # so it always goes through full URL resolution below.
    if canonical.startswith("/") and not canonical.startswith("//"):
        return canonical

    direct = urlparse(canonical)
    if direct.scheme and direct.netloc:
        parsed = direct
    elif base_url:
        parsed = urlparse(urljoin(base_url, canonical))
    else:
        _warn(
            f'canonical URL "{canonical}" for {source_url} is malformed or relative '
            "with no baseUrl configured -- ignoring, indexing with "
            f"{source_url} instead."
        )
        return source_url

    if parsed.scheme not in _SAFE_URL_PROTOCOLS or not parsed.netloc:
        _warn(
            f'canonical URL "{canonical}" for {source_url} uses a disallowed '
            f"protocol ({parsed.scheme}:) -- ignoring, indexing with {source_url} instead."
        )
        return source_url

    if allowed_url_origins is not None:
        origin = f"{parsed.scheme}://{parsed.netloc}"
        if origin not in allowed_url_origins:
            _warn(
                f'canonical URL "{canonical}" for {source_url} resolves to an '
                f"origin ({origin}) not in allowed_url_origins -- ignoring, "
                f"indexing with {source_url} instead."
            )
            return source_url

    return parsed.geturl()


def extract_document(
    html: str,
    source_url: str,
    default_language: str = "en",
    allowed_url_origins: list[str] | None = None,
    canonical_base_url: str | None = None,
) -> ExtractedDocument:
    tree = HTMLParser(html)

    noindex = tree.css_first('meta[name="csf-noindex"]') is not None

    title_node = tree.css_first("title")
    title = _collapse_whitespace(title_node.text(deep=True, separator=" ") if title_node else "")

    html_node = tree.css_first("html")
    declared_language = (
        (html_node.attributes.get("lang") or "").strip() if html_node else ""
    )

    canonical_node = tree.css_first('link[rel="canonical"]')
    canonical = (
        (canonical_node.attributes.get("href") or "").strip() if canonical_node else ""
    )
    url = _sanitize_canonical_url(
        canonical, source_url, allowed_url_origins, canonical_base_url
    )

    desc_node = tree.css_first('meta[name="description"]')
    excerpt = _collapse_whitespace(
        (desc_node.attributes.get("content") or "") if desc_node else ""
    )

    body_node = (
        tree.css_first("[data-csf-body]")
        or tree.css_first("main")
        or tree.css_first("body")
    )
    if body_node is not None:
        selector = ",".join([*_BOILERPLATE_SELECTORS, "[data-csf-ignore]"])
        for el in body_node.css(selector):
            el.decompose()
    body = _collapse_whitespace(body_node.text(deep=True, separator=" ") if body_node else "")

    language = (
        declared_language
        or detect_language(f"{title} {body}", get_registered_language_codes())
        or default_language
    )

    boost_node = tree.css_first('meta[name="csf-boost"]')
    parsed_boost = _parse_float_or_nan(
        boost_node.attributes.get("content") if boost_node else None
    )
    boost = parsed_boost if math.isfinite(parsed_boost) and parsed_boost > 0 else 1.0

    facets: dict[str, list[str]] = {}
    range_facets: dict[str, float] = {}
    for meta in tree.css("meta"):
        name = meta.attributes.get("name") or ""
        if name.startswith(_RANGE_FACET_TAG_PREFIX):
            field_name = name[len(_RANGE_FACET_TAG_PREFIX) :]
            raw = (meta.attributes.get("content") or "").strip()
            parsed = _parse_float_or_nan(raw)
            if field_name and math.isfinite(parsed) and field_name not in range_facets:
                range_facets[field_name] = parsed
            continue
        if not name.startswith(_FACET_TAG_PREFIX):
            continue
        field_name = name[len(_FACET_TAG_PREFIX) :]
        value = (meta.attributes.get("content") or "").strip()
        if not field_name or not value:
            continue
        values = facets.setdefault(field_name, [])
        if value not in values:
            values.append(value)

    pin_phrases = [
        (el.attributes.get("content") or "").strip()
        for el in tree.css('meta[name="csf-pin"]')
    ]
    pin_phrases = [p for p in pin_phrases if p]

    pin_mode_node = tree.css_first('meta[name="csf-pin-mode"]')
    pin_mode_attr = (
        (pin_mode_node.attributes.get("content") or "").strip() if pin_mode_node else ""
    )
    pin_mode = "contains" if pin_mode_attr == "contains" else "exact"

    pin_priority_node = tree.css_first('meta[name="csf-pin-priority"]')
    parsed_priority = _parse_float_or_nan(
        pin_priority_node.attributes.get("content") if pin_priority_node else None
    )
    pin_priority = parsed_priority if math.isfinite(parsed_priority) else 0.0

    pin_exclusive = tree.css_first('meta[name="csf-pin-exclusive"]') is not None

    pins = [
        PinDeclaration(
            phrase=phrase, mode=pin_mode, priority=pin_priority, exclusive=pin_exclusive
        )
        for phrase in pin_phrases
    ]

    return ExtractedDocument(
        title=title,
        language=language,
        body=body,
        excerpt=excerpt,
        url=url,
        noindex=noindex,
        boost=boost,
        facets=facets,
        range_facets=range_facets,
        pins=pins,
    )
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
uv run pytest tests/test_extract.py -v
```
Expected: PASS (12 passed).

- [ ] **Step 5: Commit**

```bash
git add python/csf-indexer/src/csf_indexer/extract.py python/csf-indexer/tests/test_extract.py
git commit -m "feat(csf-indexer): add extract_document (title/body/language/canonical/boost)"
```

---

## Task 14: `extract.py` part 2 — facet/range-facet/pin test coverage

The parsing logic already shipped in Task 13; this task adds the test coverage for it (kept as a separate task for reviewability, per the design doc's note that `extract.py` has full parity even though `build_index.py` doesn't consume facets/pins yet).

**Files:**
- Modify: `python/csf-indexer/tests/test_extract.py` (append)

**Interfaces:**
- None new — exercises the existing `extract_document()` from Task 13.

- [ ] **Step 1: Write the failing tests (append to `test_extract.py`)**

```python
def test_facet_meta_tags_collect_distinct_values():
    html = """
    <html lang="en">
      <head>
        <title>T</title>
        <meta name="csf-facet-category" content="Electronics">
        <meta name="csf-facet-category" content="Audio">
        <meta name="csf-facet-category" content="Electronics">
      </head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert doc.facets["category"] == ["Electronics", "Audio"]


def test_range_facet_meta_tag_parses_a_single_numeric_value():
    html = """
    <html lang="en">
      <head><title>T</title><meta name="csf-facet-range-price" content="49.99"></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert doc.range_facets["price"] == 49.99


def test_range_facet_prefix_does_not_get_misparsed_as_a_terms_facet():
    html = """
    <html lang="en">
      <head><title>T</title><meta name="csf-facet-range-price" content="10"></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert "range-price" not in doc.facets
    assert doc.range_facets["price"] == 10.0


def test_pin_meta_tags_produce_pin_declarations():
    html = """
    <html lang="en">
      <head>
        <title>T</title>
        <meta name="csf-pin" content="widgets">
        <meta name="csf-pin-mode" content="contains">
        <meta name="csf-pin-priority" content="5">
        <meta name="csf-pin-exclusive">
      </head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert len(doc.pins) == 1
    pin = doc.pins[0]
    assert pin.phrase == "widgets"
    assert pin.mode == "contains"
    assert pin.priority == 5.0
    assert pin.exclusive is True


def test_pin_defaults_when_mode_and_priority_absent():
    html = """
    <html lang="en">
      <head><title>T</title><meta name="csf-pin" content="gadgets"></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert doc.pins[0].mode == "exact"
    assert doc.pins[0].priority == 0.0
    assert doc.pins[0].exclusive is False


def test_no_pins_when_no_csf_pin_tag_present():
    html = """
    <html lang="en">
      <head><title>T</title></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert doc.pins == []
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run pytest tests/test_extract.py -v -k "facet or pin"
```
Expected: If Task 13's implementation is faithful, these should already PASS (the logic shipped together). If any fail, fix `extract.py` before proceeding — do not weaken the test to match a bug.

- [ ] **Step 3: Confirm all pass**

```bash
uv run pytest tests/test_extract.py -v
```
Expected: PASS (18 passed total).

- [ ] **Step 4: Commit**

```bash
git add python/csf-indexer/tests/test_extract.py
git commit -m "test(csf-indexer): add facet/range-facet/pin coverage for extract_document"
```

---

## Task 15: `build_index.py`

Ports the Phase-2 subset of `packages/indexer/src/build-index.ts`: field boosts, tokenization via `csf_analysis`, inverted index (`df`/`postings`/`tf`/`pos`/`len`), doc store, manifest assembly. No facets/synonyms/fuzzy/pins.

**Files:**
- Create: `python/csf-indexer/src/csf_indexer/build_index.py`
- Test: `python/csf-indexer/tests/test_build_index.py`

**Interfaces:**
- Consumes: `SourceDocument`, `BuiltIndex` (Task 11); `extract_document` (Task 13); `analyze`, `get_language_profile` (from `csf_analysis`).
- Produces: `build_index(sources: list[SourceDocument], default_language: str = "en", field_boosts: dict[str, float] | None = None, allowed_url_origins: list[str] | None = None, canonical_base_url: str | None = None) -> BuiltIndex`, used by `cli.py` (Task 17).

- [ ] **Step 1: Write the failing test**

```python
import pytest

from csf_indexer.build_index import build_index
from csf_indexer.types import SourceDocument


def _doc(doc_id: int, url: str, title: str, body: str, lang: str = "en") -> SourceDocument:
    html = f'<html lang="{lang}"><head><title>{title}</title></head><body><main>{body}</main></body></html>'
    return SourceDocument(id=doc_id, url=url, html=html)


def test_indexes_title_and_body_terms_with_postings():
    sources = [_doc(1, "/widgets", "Widgets", "Our widgets are wonderful.")]
    built = build_index(sources)
    en_shard = built.term_shards["en"]
    assert "widget" in en_shard
    entry = en_shard["widget"]
    assert entry["df"] == 1
    posting = entry["postings"][0]
    assert posting["doc"] == 1
    assert posting["fields"]["title"]["tf"] == 1
    assert posting["fields"]["body"]["tf"] == 1


def test_postings_are_sorted_by_doc_id():
    sources = [
        _doc(3, "/c", "Widgets", "widgets"),
        _doc(1, "/a", "Widgets", "widgets"),
        _doc(2, "/b", "Widgets", "widgets"),
    ]
    built = build_index(sources)
    doc_ids = [p["doc"] for p in built.term_shards["en"]["widget"]["postings"]]
    assert doc_ids == [1, 2, 3]


def test_doc_store_holds_url_title_and_excerpt():
    sources = [_doc(1, "/widgets", "Widgets", "Our widgets are wonderful and useful for everyone.")]
    built = build_index(sources)
    entry = built.doc_store["1"]
    assert entry["url"] == "/widgets"
    assert entry["fields"]["title"] == "Widgets"
    assert "wonderful" in entry["fields"]["excerpt"]
    assert "body" not in entry["fields"]


def test_noindex_documents_are_skipped():
    html = '<html lang="en"><head><title>T</title><meta name="csf-noindex" content="true"></head><body><main>Content</main></body></html>'
    sources = [SourceDocument(id=1, url="/hidden", html=html)]
    built = build_index(sources)
    assert built.doc_store == {}
    assert built.term_shards == {}


def test_field_boosts_default_to_title_3_body_1():
    built = build_index([_doc(1, "/a", "T", "b")])
    assert built.manifest["fields"]["title"]["boost"] == 3.0
    assert built.manifest["fields"]["body"]["boost"] == 1.0


def test_field_boosts_can_be_overridden():
    built = build_index([_doc(1, "/a", "T", "b")], field_boosts={"title": 5.0})
    assert built.manifest["fields"]["title"]["boost"] == 5.0
    assert built.manifest["fields"]["body"]["boost"] == 1.0


def test_multi_language_corpus_gets_a_shard_per_language():
    sources = [
        _doc(1, "/en", "Widgets", "widgets", lang="en"),
        _doc(2, "/de", "Sofas", "sofas sind bequem", lang="de"),
    ]
    built = build_index(sources)
    assert set(built.term_shards.keys()) == {"en", "de"}
    assert built.manifest["languages"] == ["de", "en"]


def test_id_range_covers_min_and_max_indexed_ids():
    sources = [_doc(5, "/a", "T", "b"), _doc(1, "/b", "T", "b"), _doc(3, "/c", "T", "b")]
    built = build_index(sources)
    assert built.id_range == (1, 5)


def test_duplicate_ids_raise_value_error():
    sources = [_doc(1, "/a", "T", "b"), _doc(1, "/b", "T", "b")]
    with pytest.raises(ValueError, match="duplicate document id"):
        build_index(sources)


def test_negative_id_raises_value_error():
    sources = [_doc(-1, "/a", "T", "b")]
    with pytest.raises(ValueError, match="invalid document id"):
        build_index(sources)


def test_manifest_shape_matches_the_json_schema_expectations():
    built = build_index([_doc(1, "/a", "Widgets", "widgets are great")])
    manifest = built.manifest
    assert manifest["version"] == 1
    assert manifest["format"] == "json"
    assert manifest["defaultLanguage"] == "en"
    assert manifest["docCount"]["en"] == 1
    assert manifest["avgFieldLength"]["en"]["title"] > 0
    assert manifest["shards"] == {"terms": [], "docs": []}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/test_build_index.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'csf_indexer.build_index'`.

- [ ] **Step 3: Implement `build_index.py`**

```python
import datetime

from csf_analysis import analyze, get_language_profile
from csf_indexer.extract import extract_document
from csf_indexer.types import BuiltIndex, SourceDocument

_DEFAULT_FIELD_BOOSTS = {"title": 3.0, "body": 1.0}
_EXCERPT_LENGTH = 200


def _validate_source_ids(sources: list[SourceDocument]) -> None:
    seen: set[int] = set()
    for source in sources:
        if not isinstance(source.id, int) or isinstance(source.id, bool) or source.id < 0:
            raise ValueError(
                f"build_index: invalid document id {source.id!r} for "
                f'"{source.url}" -- ids must be non-negative integers'
            )
        if source.id in seen:
            raise ValueError(
                f"build_index: duplicate document id {source.id} "
                f'(seen again at "{source.url}") -- every source document '
                "must have a unique id"
            )
        seen.add(source.id)


def _derive_excerpt(body: str) -> str:
    if len(body) <= _EXCERPT_LENGTH:
        return body
    return body[:_EXCERPT_LENGTH].rstrip() + "…"


def _add_postings(shard, posting_index, field_name, doc_id, doc_boost, tokens) -> None:
    field_length = len(tokens)
    positions_by_term: dict[str, list[int]] = {}
    for token in tokens:
        positions_by_term.setdefault(token.term, []).append(token.position)

    for term, positions in positions_by_term.items():
        entry = shard.setdefault(term, {"df": 0, "postings": []})
        doc_index = posting_index.setdefault(term, {})
        posting = doc_index.get(doc_id)
        if posting is None:
            posting = {"doc": doc_id, "fields": {}}
            if doc_boost != 1.0:
                posting["boost"] = doc_boost
            entry["postings"].append(posting)
            entry["df"] += 1
            doc_index[doc_id] = posting
        posting["fields"][field_name] = {
            "tf": len(positions),
            "pos": positions,
            "len": field_length,
        }


def build_index(
    sources: list[SourceDocument],
    default_language: str = "en",
    field_boosts: dict[str, float] | None = None,
    allowed_url_origins: list[str] | None = None,
    canonical_base_url: str | None = None,
) -> BuiltIndex:
    _validate_source_ids(sources)
    boosts = {**_DEFAULT_FIELD_BOOSTS, **(field_boosts or {})}

    term_shards: dict[str, dict] = {}
    posting_index_by_language: dict[str, dict] = {}
    doc_store: dict = {}
    stats_by_language: dict[str, dict] = {}
    indexed_count = 0
    min_id: int | None = None
    max_id: int | None = None

    for source in sources:
        extracted = extract_document(
            source.html,
            source.url,
            default_language,
            allowed_url_origins=allowed_url_origins,
            canonical_base_url=canonical_base_url,
        )
        if extracted.noindex:
            continue

        language = extracted.language
        profile = get_language_profile(language)

        title_tokens = analyze(extracted.title, profile)
        body_tokens = analyze(extracted.body, profile)

        stats = stats_by_language.setdefault(
            language, {"title": 0, "body": 0, "count": 0}
        )
        stats["title"] += len(title_tokens)
        stats["body"] += len(body_tokens)
        stats["count"] += 1

        term_shard = term_shards.setdefault(language, {})
        posting_index = posting_index_by_language.setdefault(language, {})
        _add_postings(
            term_shard, posting_index, "title", source.id, extracted.boost, title_tokens
        )
        _add_postings(
            term_shard, posting_index, "body", source.id, extracted.boost, body_tokens
        )

        entry: dict = {
            "url": extracted.url,
            "fields": {
                "title": extracted.title,
                "excerpt": extracted.excerpt or _derive_excerpt(extracted.body),
            },
        }
        if extracted.boost != 1.0:
            entry["boost"] = extracted.boost
        doc_store[str(source.id)] = entry

        indexed_count += 1
        min_id = source.id if min_id is None else min(min_id, source.id)
        max_id = source.id if max_id is None else max(max_id, source.id)

    for term_shard in term_shards.values():
        for entry in term_shard.values():
            entry["postings"].sort(key=lambda p: p["doc"])

    languages = sorted(stats_by_language.keys()) if stats_by_language else [default_language]

    doc_count: dict[str, int] = {}
    avg_field_length: dict[str, dict[str, float]] = {}
    for language in languages:
        stats = stats_by_language.get(language)
        count = stats["count"] if stats else 0
        doc_count[language] = count
        avg_field_length[language] = {
            "title": (stats["title"] / count) if stats and count else 0.0,
            "body": (stats["body"] / count) if stats and count else 0.0,
        }

    manifest = {
        "version": 1,
        "buildId": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "format": "json",
        "languages": languages,
        "defaultLanguage": default_language,
        "fields": {
            "title": {"boost": boosts["title"], "stored": True},
            "body": {"boost": boosts["body"], "stored": False},
        },
        "docCount": doc_count,
        "avgFieldLength": avg_field_length,
        "shards": {"terms": [], "docs": []},
    }

    id_range = (min_id, max_id) if indexed_count else (0, 0)

    return BuiltIndex(
        manifest=manifest,
        term_shards=term_shards,
        doc_store=doc_store,
        id_range=id_range,
    )
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
uv run pytest tests/test_build_index.py -v
```
Expected: PASS (11 passed).

- [ ] **Step 5: Commit**

```bash
git add python/csf-indexer/src/csf_indexer/build_index.py python/csf-indexer/tests/test_build_index.py
git commit -m "feat(csf-indexer): add build_index (inverted index + doc store + manifest)"
```

---

## Task 16: `write_index.py`

Ports the Phase-2 subset of `packages/indexer/src/write-index.ts`: canonical JSON serialization, content-hashed filenames, prefix+gzip-budget auto-sharding of term shards, doc-store chunking, manifest assembly. No binary format, no fuzzy/vectors/facets/synonyms/pins sections.

**Files:**
- Create: `python/csf-indexer/src/csf_indexer/write_index.py`
- Test: `python/csf-indexer/tests/test_write_index.py`

**Interfaces:**
- Consumes: `BuiltIndex` (Task 11); `content_hash` (Task 11).
- Produces: `write_index(built: BuiltIndex, out_dir: str, max_shard_gzip_bytes: int = DEFAULT_MAX_TERM_SHARD_GZIP_BYTES, shard_by_prefix: bool = True, doc_store_shard_size: float = float("inf")) -> None`, used by `cli.py` (Task 17).

- [ ] **Step 1: Write the failing test**

```python
import json
from pathlib import Path

from csf_indexer.build_index import build_index
from csf_indexer.types import SourceDocument
from csf_indexer.write_index import write_index


def _doc(doc_id: int, url: str, title: str, body: str) -> SourceDocument:
    html = f'<html lang="en"><head><title>{title}</title></head><body><main>{body}</main></body></html>'
    return SourceDocument(id=doc_id, url=url, html=html)


def test_writes_manifest_json_and_it_is_valid_json(tmp_path: Path):
    built = build_index([_doc(1, "/a", "Widgets", "widgets are great")])
    write_index(built, str(tmp_path))
    manifest_path = tmp_path / "manifest.json"
    assert manifest_path.exists()
    manifest = json.loads(manifest_path.read_text())
    assert manifest["version"] == 1
    assert manifest["shards"]["terms"]
    assert manifest["shards"]["docs"]


def test_term_shard_files_are_content_hashed_and_readable(tmp_path: Path):
    built = build_index([_doc(1, "/a", "Widgets", "widgets are great")])
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    term_entry = manifest["shards"]["terms"][0]
    assert term_entry["lang"] == "en"
    term_file = tmp_path / term_entry["file"]
    assert term_file.exists()
    assert "." in term_entry["file"].removesuffix(".json")  # hash segment present
    term_shard = json.loads(term_file.read_text())
    assert "widget" in term_shard


def test_doc_store_file_is_written_and_readable(tmp_path: Path):
    built = build_index([_doc(1, "/a", "Widgets", "widgets are great")])
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    docs_entry = manifest["shards"]["docs"][0]
    assert docs_entry["idRange"] == [1, 1]
    docs_file = tmp_path / docs_entry["file"]
    doc_store = json.loads(docs_file.read_text())
    assert doc_store["1"]["url"] == "/a"


def test_shard_by_prefix_false_writes_one_shard_named_all(tmp_path: Path):
    built = build_index([_doc(1, "/a", "Widgets", "widgets and gadgets")])
    write_index(built, str(tmp_path), shard_by_prefix=False)
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    terms = manifest["shards"]["terms"]
    assert len(terms) == 1
    assert terms[0]["prefix"] == "all"


def test_empty_corpus_still_writes_one_empty_doc_store_shard(tmp_path: Path):
    built = build_index([])
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert len(manifest["shards"]["docs"]) == 1
    docs_file = tmp_path / manifest["shards"]["docs"][0]["file"]
    assert json.loads(docs_file.read_text()) == {}


def test_output_is_byte_identical_across_repeated_builds_of_the_same_corpus(tmp_path: Path):
    sources = [_doc(1, "/a", "Widgets", "widgets"), _doc(2, "/b", "Gadgets", "gadgets")]
    out1, out2 = tmp_path / "out1", tmp_path / "out2"
    write_index(build_index(sources), str(out1))
    write_index(build_index(sources), str(out2))
    # buildId is a timestamp, so compare everything except that one field.
    m1 = json.loads((out1 / "manifest.json").read_text())
    m2 = json.loads((out2 / "manifest.json").read_text())
    m1.pop("buildId")
    m2.pop("buildId")
    assert m1 == m2
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/test_write_index.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'csf_indexer.write_index'`.

- [ ] **Step 3: Implement `write_index.py`**

```python
import gzip
import json
import re
from pathlib import Path

from csf_indexer.hash import content_hash
from csf_indexer.types import BuiltIndex

DEFAULT_MAX_TERM_SHARD_GZIP_BYTES = 50 * 1024
_MAX_PREFIX_LENGTH = 8


def _canonicalize(value):
    if isinstance(value, list):
        return [_canonicalize(v) for v in value]
    if isinstance(value, tuple):
        return [_canonicalize(v) for v in value]
    if isinstance(value, dict):
        return {key: _canonicalize(value[key]) for key in sorted(value.keys())}
    return value


def _to_json(data) -> str:
    return json.dumps(_canonicalize(data), separators=(",", ":"), ensure_ascii=False)


def _write_json(out_dir: str, rel_path: str, data) -> str:
    content = _to_json(data)
    digest = content_hash(content)
    hashed_rel_path = re.sub(r"\.json$", f".{digest}.json", rel_path)
    abs_path = Path(out_dir) / hashed_rel_path
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_text(content, encoding="utf-8")
    return hashed_rel_path


def _gzip_byte_size(term_shard: dict) -> int:
    return len(gzip.compress(_to_json(term_shard).encode("utf-8")))


def _group_by_prefix_length(term_shard: dict, prefix_length: int) -> dict[str, dict]:
    groups: dict[str, dict] = {}
    for term, entry in term_shard.items():
        prefix = term[:prefix_length]
        groups.setdefault(prefix, {})[term] = entry
    return groups


def _split_oversized_bucket(
    prefix: str,
    group: dict,
    prefix_length: int,
    language: str,
    max_gzip_bytes: int,
    result: dict[str, dict],
) -> None:
    size = _gzip_byte_size(group)
    if size <= max_gzip_bytes:
        result[prefix] = group
        return
    term_count = len(group)
    if term_count <= 1 or prefix_length >= _MAX_PREFIX_LENGTH:
        result[prefix] = group
        return
    sub_buckets = _group_by_prefix_length(group, prefix_length + 1)
    if len(sub_buckets) <= 1:
        result[prefix] = group
        return
    for sub_prefix, sub_group in sub_buckets.items():
        _split_oversized_bucket(
            sub_prefix, sub_group, prefix_length + 1, language, max_gzip_bytes, result
        )


def _shard_terms_by_prefix(
    term_shard: dict, language: str, max_gzip_bytes: int
) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for prefix, group in _group_by_prefix_length(term_shard, 1).items():
        _split_oversized_bucket(prefix, group, 1, language, max_gzip_bytes, result)
    return result


def _chunk_doc_store_by_id_range(doc_store: dict, shard_size: float) -> list[dict]:
    sorted_ids = sorted(int(k) for k in doc_store.keys())
    chunks: list[dict] = []
    step = len(sorted_ids) if shard_size == float("inf") else int(shard_size)
    step = max(step, 1)
    i = 0
    while i < len(sorted_ids):
        ids_in_chunk = sorted_ids[i : i + step]
        shard = {str(doc_id): doc_store[str(doc_id)] for doc_id in ids_in_chunk}
        chunks.append({"idRange": (ids_in_chunk[0], ids_in_chunk[-1]), "shard": shard})
        i += step
    return chunks


def write_index(
    built: BuiltIndex,
    out_dir: str,
    max_shard_gzip_bytes: int = DEFAULT_MAX_TERM_SHARD_GZIP_BYTES,
    shard_by_prefix: bool = True,
    doc_store_shard_size: float = float("inf"),
) -> None:
    languages = sorted(built.term_shards.keys())
    terms: list[dict] = []
    for language in languages:
        term_shard = built.term_shards.get(language, {})
        if shard_by_prefix:
            buckets = sorted(
                _shard_terms_by_prefix(term_shard, language, max_shard_gzip_bytes).items()
            )
        else:
            buckets = [("all", term_shard)]
        for prefix, group in buckets:
            file = _write_json(out_dir, f"terms/{language}/{prefix}.json", group)
            terms.append(
                {"lang": language, "prefix": prefix, "file": file, "termCount": len(group)}
            )

    doc_store_chunks = _chunk_doc_store_by_id_range(built.doc_store, doc_store_shard_size)
    if not doc_store_chunks:
        doc_store_chunks = [{"idRange": built.id_range, "shard": {}}]
    docs: list[dict] = []
    for shard_index, chunk in enumerate(doc_store_chunks):
        file = _write_json(out_dir, f"docs/{shard_index}.json", chunk["shard"])
        docs.append(
            {"shard": shard_index, "file": file, "idRange": list(chunk["idRange"])}
        )

    manifest = {**built.manifest, "shards": {"terms": terms, "docs": docs}}

    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)
    (out_path / "manifest.json").write_text(_to_json(manifest), encoding="utf-8")
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
uv run pytest tests/test_write_index.py -v
```
Expected: PASS (6 passed).

- [ ] **Step 5: Commit**

```bash
git add python/csf-indexer/src/csf_indexer/write_index.py python/csf-indexer/tests/test_write_index.py
git commit -m "feat(csf-indexer): add write_index (canonical JSON, hashing, sharding)"
```

---

## Task 17: `cli.py` + end-to-end test

Direct port of `packages/indexer/src/cli.ts`.

**Files:**
- Create: `python/csf-indexer/src/csf_indexer/cli.py`
- Test: `python/csf-indexer/tests/test_cli.py`

**Interfaces:**
- Consumes: `discover_html_documents` (Task 12), `build_index` (Task 15), `write_index` (Task 16).
- Produces: `main() -> None` (console-script entry point `csf-indexer`, registered in `pyproject.toml`'s `[project.scripts]`, Task 11).

- [ ] **Step 1: Write the failing test**

```python
import json
import subprocess
import sys
from pathlib import Path


def test_cli_indexes_a_directory_and_writes_a_manifest(tmp_path: Path):
    src_dir = tmp_path / "site"
    src_dir.mkdir()
    (src_dir / "index.html").write_text(
        '<html lang="en"><head><title>Home</title></head>'
        "<body><main><p>Welcome to our widgets store.</p></main></body></html>"
    )
    out_dir = tmp_path / "out"

    result = subprocess.run(
        [sys.executable, "-m", "csf_indexer.cli", str(src_dir), str(out_dir)],
        capture_output=True,
        text=True,
        check=True,
    )

    assert "indexed 1 document(s)" in result.stdout
    manifest = json.loads((out_dir / "manifest.json").read_text())
    assert manifest["docCount"]["en"] == 1


def test_cli_errors_with_usage_when_missing_arguments():
    result = subprocess.run(
        [sys.executable, "-m", "csf_indexer.cli"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1
    assert "usage: csf-indexer" in result.stderr
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/test_cli.py -v
```
Expected: FAIL — `csf_indexer.cli` module doesn't exist, or `python -m` errors.

- [ ] **Step 3: Implement `cli.py`**

```python
import sys

from csf_indexer.build_index import build_index
from csf_indexer.discover import discover_html_documents
from csf_indexer.write_index import write_index


def main() -> None:
    args = sys.argv[1:]
    if len(args) != 2:
        print("usage: csf-indexer <inputDir> <outDir>", file=sys.stderr)
        sys.exit(1)

    input_dir, out_dir = args
    sources = discover_html_documents(input_dir)
    built = build_index(sources)
    write_index(built, out_dir)
    total_docs = sum(built.manifest["docCount"].values())
    print(f"indexed {total_docs} document(s) from {input_dir} -> {out_dir}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
uv run pytest tests/test_cli.py -v
```
Expected: PASS (2 passed).

- [ ] **Step 5: Verify the installed console script also works**

```bash
uv run csf-indexer --help 2>&1 | head -1 || true
uv sync
echo '<html lang="en"><head><title>Test</title></head><body><main>hello</main></body></html>' > /tmp/csf-cli-smoke/index.html 2>/dev/null || (mkdir -p /tmp/csf-cli-smoke && echo '<html lang="en"><head><title>Test</title></head><body><main>hello</main></body></html>' > /tmp/csf-cli-smoke/index.html)
uv run csf-indexer /tmp/csf-cli-smoke /tmp/csf-cli-out
cat /tmp/csf-cli-out/manifest.json
```
Expected: prints a manifest JSON with `"docCount":{"en":1}`.

- [ ] **Step 6: Commit**

```bash
git add python/csf-indexer/src/csf_indexer/cli.py python/csf-indexer/tests/test_cli.py
git commit -m "feat(csf-indexer): add csf-indexer CLI entry point"
```

---

## Task 18: Schema validation test

Validates every JSON shape `write_index()` emits against the frozen schemas in `spec/schema/`, using the `jsonschema` dev dependency already declared in Task 11's `pyproject.toml`.

**Files:**
- Create: `python/csf-indexer/tests/test_schema_conformance.py`

**Interfaces:**
- Consumes: `build_index`, `write_index` (Tasks 15-16); `spec/schema/manifest.schema.json`, `spec/schema/term-shard.schema.json`, `spec/schema/doc-store-shard.schema.json` (repo root, referenced via a relative path from the test file).

- [ ] **Step 1: Write the failing test**

```python
import json
from pathlib import Path

import jsonschema

from csf_indexer.build_index import build_index
from csf_indexer.types import SourceDocument
from csf_indexer.write_index import write_index

_REPO_ROOT = Path(__file__).resolve().parents[3]
_SCHEMA_DIR = _REPO_ROOT / "spec" / "schema"


def _load_schema(name: str) -> dict:
    return json.loads((_SCHEMA_DIR / name).read_text())


def _doc(doc_id: int, url: str, title: str, body: str, lang: str = "en") -> SourceDocument:
    html = f'<html lang="{lang}"><head><title>{title}</title></head><body><main>{body}</main></body></html>'
    return SourceDocument(id=doc_id, url=url, html=html)


def test_manifest_validates_against_manifest_schema(tmp_path):
    sources = [
        _doc(1, "/a", "Widgets", "Our widgets are wonderful and useful."),
        _doc(2, "/b", "Sofas", "Unsere Sofas sind sehr bequem.", lang="de"),
    ]
    built = build_index(sources)
    write_index(built, str(tmp_path))

    manifest = json.loads((tmp_path / "manifest.json").read_text())
    schema = _load_schema("manifest.schema.json")
    jsonschema.validate(instance=manifest, schema=schema)


def test_term_shard_validates_against_term_shard_schema(tmp_path):
    built = build_index([_doc(1, "/a", "Widgets", "widgets are great and useful")])
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())

    schema = _load_schema("term-shard.schema.json")
    for term_entry in manifest["shards"]["terms"]:
        term_shard = json.loads((tmp_path / term_entry["file"]).read_text())
        jsonschema.validate(instance=term_shard, schema=schema)


def test_doc_store_shard_validates_against_doc_store_shard_schema(tmp_path):
    built = build_index([_doc(1, "/a", "Widgets", "widgets are great")])
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())

    schema = _load_schema("doc-store-shard.schema.json")
    for docs_entry in manifest["shards"]["docs"]:
        doc_store_shard = json.loads((tmp_path / docs_entry["file"]).read_text())
        jsonschema.validate(instance=doc_store_shard, schema=schema)
```

- [ ] **Step 2: Run test to verify it fails or passes**

```bash
uv run pytest tests/test_schema_conformance.py -v
```
Expected: PASS if Tasks 15-16 are faithful ports (this test validates existing behavior, doesn't require new implementation code) — if any assertion fails, fix `build_index.py`/`write_index.py`'s output shape, don't weaken the schema check.

- [ ] **Step 3: Confirm pass**

```bash
uv run pytest tests/test_schema_conformance.py -v
```
Expected: PASS (3 passed).

- [ ] **Step 4: Commit**

```bash
git add python/csf-indexer/tests/test_schema_conformance.py
git commit -m "test(csf-indexer): validate manifest/term-shard/doc-store output against spec/schema"
```

---

## Task 19: Cross-implementation conformance test (TypeScript side)

Extends the existing pattern in `packages/client/test/cross-implementation-conformance.test.ts` (which currently shells out to the *minimal* `spec/examples/python/generate_index.py`) with a new test that shells out to the **real** `csf-indexer` Python CLI instead, and asserts the same `SearchClient` query results as a TS-built index of the same fixture.

**Files:**
- Read: `packages/client/test/cross-implementation-conformance.test.ts` (existing pattern to extend)
- Create: `packages/client/test/cross-implementation-conformance-python-indexer.test.ts`

**Interfaces:**
- Consumes: the installed `csf-indexer` Python CLI (via `uv run csf-indexer <src> <out>` subprocess, requires `python/csf-indexer` to have been `uv sync`-ed); `SearchClient` from `@csf/client`; the existing test's HTTP-serving helper utilities.

- [ ] **Step 1: Read the existing conformance test to match its structure**

```bash
cat packages/client/test/cross-implementation-conformance.test.ts
```

Note its fixture corpus shape, its HTTP-serving setup/teardown, and its query assertions (same matching doc ids, not identical scores) — the new test reuses this same structure and the same documented tolerance for tokenization differences, just against a different subprocess command and a richer fixture (multi-field, multi-language, matching this plan's Task 15's scope).

- [ ] **Step 2: Write the new test**

```typescript
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SearchClient } from "../src/index.js";
import { buildIndex } from "@csf/indexer/build-index.js";
import { writeIndex } from "@csf/indexer/write-index.js";
import { startStaticServer } from "./static-server.js";

const execFileAsync = promisify(execFile);

const FIXTURE_SOURCES = [
  {
    id: 1,
    url: "/en-widgets",
    html: `<html lang="en"><head><title>Widgets</title></head><body><main><p>Our widgets are wonderful and useful for everyone.</p></main></body></html>`,
  },
  {
    id: 2,
    url: "/en-gadgets",
    html: `<html lang="en"><head><title>Gadgets</title></head><body><main><p>Gadgets and gizmos for every home and office.</p></main></body></html>`,
  },
  {
    id: 3,
    url: "/de-sofas",
    html: `<html lang="de"><head><title>Sofas</title></head><body><main><p>Unsere Sofas sind sehr bequem und gross.</p></main></body></html>`,
  },
];

const REPO_ROOT = join(__dirname, "..", "..", "..");
const PYTHON_INDEXER_DIR = join(REPO_ROOT, "python", "csf-indexer");

describe("cross-implementation conformance: real csf-indexer Python CLI", () => {
  let tsOutDir: string;
  let pyOutDir: string;
  let tsServer: { url: string; close: () => Promise<void> };
  let pyServer: { url: string; close: () => Promise<void> };

  beforeEach(async () => {
    tsOutDir = await mkdtemp(join(tmpdir(), "csf-conformance-ts-"));
    pyOutDir = await mkdtemp(join(tmpdir(), "csf-conformance-py-"));

    const built = buildIndex(FIXTURE_SOURCES, "en");
    await writeIndex(built, tsOutDir);

    const srcDir = await mkdtemp(join(tmpdir(), "csf-conformance-src-"));
    const { writeFile, mkdir } = await import("node:fs/promises");
    for (const source of FIXTURE_SOURCES) {
      const filePath = join(srcDir, `${source.id}.html`);
      await writeFile(filePath, source.html, "utf8");
    }
    await execFileAsync("uv", ["run", "csf-indexer", srcDir, pyOutDir], {
      cwd: PYTHON_INDEXER_DIR,
    });

    tsServer = await startStaticServer(tsOutDir);
    pyServer = await startStaticServer(pyOutDir);
  });

  afterEach(async () => {
    await tsServer.close();
    await pyServer.close();
    await rm(tsOutDir, { recursive: true, force: true });
    await rm(pyOutDir, { recursive: true, force: true });
  });

  it("returns the same matching doc ids for an English query against both implementations", async () => {
    const tsClient = new SearchClient({ indexUrl: `${tsServer.url}/manifest.json` });
    const pyClient = new SearchClient({ indexUrl: `${pyServer.url}/manifest.json` });

    const tsResult = await tsClient.search("widgets");
    const pyResult = await pyClient.search("widgets");

    const tsIds = tsResult.hits.map((h) => h.id).sort();
    const pyIds = pyResult.hits.map((h) => h.id).sort();
    expect(pyIds).toEqual(tsIds);
    expect(tsIds).toContain(1);
  });

  it("returns the same matching doc ids for a German query against both implementations", async () => {
    const tsClient = new SearchClient({ indexUrl: `${tsServer.url}/manifest.json` });
    const pyClient = new SearchClient({ indexUrl: `${pyServer.url}/manifest.json` });

    const tsResult = await tsClient.search("sofas", { language: "de" });
    const pyResult = await pyClient.search("sofas", { language: "de" });

    const tsIds = tsResult.hits.map((h) => h.id).sort();
    const pyIds = pyResult.hits.map((h) => h.id).sort();
    expect(pyIds).toEqual(tsIds);
    expect(tsIds).toContain(3);
  });
});
```

- [ ] **Step 3: Ensure the Python indexer environment is set up, then run the test**

```bash
cd python/csf-indexer && uv sync && cd ../..
npx vitest run packages/client/test/cross-implementation-conformance-python-indexer.test.ts
```
Expected: PASS (2 passed). If it fails, inspect whether the mismatch is a real bug (fix `build_index.py`/`extract.py`) versus an expected tokenization difference for a query word that doesn't stem to itself (per this repo's existing documented caveat — adjust the fixture's query words, don't weaken the assertion).

- [ ] **Step 4: Commit**

```bash
git add packages/client/test/cross-implementation-conformance-python-indexer.test.ts
git commit -m "test: cross-implementation conformance against the real Python csf-indexer CLI"
```

---

## Task 20: CI integration

Extends `.github/workflows/ci.yml`'s existing `test` job (already runs `actions/setup-python@v6` with Python 3.12) to install `uv`, sync both new Python packages, and run their test suites — plus install `uv` before the cross-implementation conformance test (Task 19) needs it.

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- None — CI configuration only.

- [ ] **Step 1: Read the current workflow file**

```bash
cat .github/workflows/ci.yml
```

- [ ] **Step 2: Add `uv` setup and Python package test steps**

Insert new steps into the `test` job, after the existing `actions/setup-python@v6` step and before `pnpm lint` (so `uv` and the Python packages are ready before `pnpm test` runs the cross-implementation conformance test from Task 19):

```yaml
      - uses: actions/setup-python@v6
        with:
          python-version: "3.12"
      - uses: astral-sh/setup-uv@v5
        with:
          enable-cache: true
      - name: Install and test csf-analysis (Python)
        working-directory: python/csf-analysis
        run: |
          uv sync
          uv run pytest -v
      - name: Install and test csf-indexer (Python)
        working-directory: python/csf-indexer
        run: |
          uv sync
          uv run pytest -v
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
```

(Existing steps below `pnpm lint` — `pnpm typecheck`, `pnpm size`, `pnpm test`, `pnpm exec playwright install --with-deps chromium`, `pnpm test:browser` — stay as they are; `pnpm test` is what runs Task 19's new conformance test, and by this point `python/csf-indexer` has already been `uv sync`-ed above.)

- [ ] **Step 3: Verify the workflow YAML is syntactically valid**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" 2>&1 || node -e "require('js-yaml') ? console.log('ok') : console.log('no js-yaml, skip')" 2>&1 || echo "manual review only"
```
(Use whatever YAML validator is available; if none, carefully re-read the diff for indentation correctness — GitHub Actions YAML is indentation-sensitive.)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run csf-analysis and csf-indexer Python test suites"
```

- [ ] **Step 5: Push the branch and confirm CI passes**

```bash
git push -u origin feature/python-indexer-phase1
gh run watch $(gh run list --branch feature/python-indexer-phase1 --limit 1 --json databaseId --jq '.[0].databaseId')
```
Expected: the `test` job's new Python steps and the existing `pnpm test` step (including the new cross-implementation conformance test) all pass.

---

## Self-Review Notes

- **Spec coverage**: every section of `docs/superpowers/specs/2026-07-11-python-indexer-phase1-2-design.md` maps to a task — package layout (Tasks 1, 11), `csf_analysis` scope (Tasks 1-10), `csf_indexer` core scope (Tasks 11-17), testing/CI (Tasks 18-20). The design's explicit "out of scope" list (facets/synonyms/fuzzy/pins *shard-building*, vectors, binary tier) has no corresponding task, by design — `extract.py` (Tasks 13-14) parses facet/pin metadata for forward compatibility as the design specifies, but `build_index.py` (Task 15) does not consume it.
- **Type consistency**: `BuiltIndex.term_shards`/`doc_store`/`id_range`/`manifest` (Task 11) are used with identical names and shapes in `build_index.py` (Task 15) and `write_index.py` (Task 16). `ExtractedDocument`'s fields (Task 11) match exactly what `extract.py` (Task 13) constructs and what `build_index.py` (Task 15) reads. `LanguageProfile`'s `segment`/`stem`/`fold_diacritics`/`stopwords` fields (Task 6) match what `analyze.py` (Task 9) calls.
- **No placeholders**: every step above contains complete, runnable code — no `TBD`, no "similar to Task N" shortcuts, no undefined references.
